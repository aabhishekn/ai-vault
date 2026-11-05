import unittest
from unittest.mock import patch
from uuid import uuid4

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.ai.embeddings import EMBEDDING_MODEL
from app.core.errors import AppError, ConfigurationError
from app.db.database import engine
from app.db.models import Conversation, ConversationTurn, Document, DocumentChunk
from app.schemas.chat import (
    AnswerCitation,
    AnswerResponse,
    MessageRequest,
    SearchMatch,
    SearchRequest,
    SearchResponse,
)
from app.services import conversations as conversations
from tests.support import requires_database


@requires_database
class ConversationTests(unittest.TestCase):
    def setUp(self):
        self.document_id = uuid4()
        with Session(engine) as session:
            session.add(
                Document(
                    id=self.document_id,
                    filename="chat-test.pdf",
                    storage_path=f"storage/documents/{self.document_id}.pdf",
                    content_type="application/pdf",
                    size_bytes=10,
                    status="embedded",
                )
            )
            session.flush()
            chunk = DocumentChunk(
                document_id=self.document_id,
                chunk_index=0,
                page_number=3,
                text="Use FastAPI",
                embedding=[1.0] + [0.0] * 1535,
                embedding_model=EMBEDDING_MODEL,
            )
            session.add(chunk)
            session.flush()
            self.chunk_id = chunk.id
            session.commit()
        self.conversation = conversations.create_conversation(self.document_id)

    def tearDown(self):
        with Session(engine) as session:
            session.execute(delete(Document).where(Document.id == self.document_id))
            session.commit()

    def retrieve(self, document_id, request, context=None):
        self.assertEqual(document_id, self.document_id)
        return SearchResponse(
            document_id=document_id,
            question=request.question,
            matches=[
                SearchMatch(
                    chunk_id=self.chunk_id,
                    chunk_index=0,
                    page_number=3,
                    text="Use FastAPI",
                    cosine_distance=0.1,
                )
            ],
        )

    def answer(self, retrieval, *, history):
        return AnswerResponse(
            document_id=self.document_id,
            question=retrieval.question,
            answer="Use FastAPI [1].",
            insufficient_evidence=False,
            citations=[
                AnswerCitation(
                    source_number=1, chunk_id=self.chunk_id, page_number=3, text="Use FastAPI"
                )
            ],
            model="test-model",
            input_tokens=10,
            output_tokens=5,
        )

    def send(self, question):
        return conversations.send_message(self.conversation.id, SearchRequest(question=question))

    def test_saved_turns_preserve_citations_and_pass_followup_context(self):
        with patch.object(conversations, "search_document", side_effect=self.retrieve) as retrieval:
            with patch.object(
                conversations, "generate_answer", side_effect=self.answer
            ) as generator:
                first = self.send("Which backend framework?")
                second = self.send("Why use it?")
        self.assertEqual([first.turn_number, second.turn_number], [1, 2])
        history = generator.call_args.kwargs["history"]
        self.assertEqual(
            history, [{"question": "Which backend framework?", "answer": "Use FastAPI [1]."}]
        )
        # The question is searched as asked; the previous turn travels separately as context,
        # so a change of subject is not pulled back to the old one.
        self.assertEqual(retrieval.call_args.args[1].question, "Why use it?")
        self.assertIn("Which backend framework?", retrieval.call_args.kwargs["context"])
        self.assertIn("Use FastAPI [1].", retrieval.call_args.kwargs["context"])
        self.assertEqual(second.response.question, "Why use it?")
        saved = conversations.get_conversation(self.conversation.id, limit=1, offset=1)
        self.assertEqual(saved.total, 2)
        self.assertEqual(len(saved.turns), 1)
        self.assertEqual(saved.turns[0].response.citations[0].chunk_id, self.chunk_id)
        self.assertEqual(saved.turns[0].response.input_tokens, 10)

    def test_only_three_recent_turns_are_sent_as_context(self):
        with patch.object(conversations, "search_document", side_effect=self.retrieve):
            with patch.object(
                conversations, "generate_answer", side_effect=self.answer
            ) as generator:
                for number in range(5):
                    self.send(f"Question {number}")
        self.assertEqual(
            [item["question"] for item in generator.call_args.kwargs["history"]],
            ["Question 1", "Question 2", "Question 3"],
        )

    def test_generation_failure_does_not_save_a_partial_turn(self):
        with patch.object(conversations, "search_document", side_effect=self.retrieve):
            with patch.object(
                conversations, "generate_answer", side_effect=ConfigurationError("private details")
            ):
                with self.assertRaises(AppError) as error:
                    self.send("Question")
        self.assertEqual(error.exception.status_code, 503)
        saved = conversations.get_conversation(self.conversation.id, limit=20, offset=0)
        self.assertEqual(saved.total, 0)
        self.assertEqual(saved.turns, [])

    def test_concurrent_history_change_returns_conflict(self):

        def concurrent_answer(retrieval, *, history):
            answer = self.answer(retrieval, history=history)
            with Session(engine) as session:
                session.get(Conversation, self.conversation.id).turn_count = 1
                session.add(
                    ConversationTurn(
                        conversation_id=self.conversation.id,
                        turn_number=1,
                        response=answer.model_dump(mode="json"),
                    )
                )
                session.commit()
            return answer

        with patch.object(conversations, "search_document", side_effect=self.retrieve):
            with patch.object(conversations, "generate_answer", side_effect=concurrent_answer):
                with self.assertRaises(AppError) as error:
                    self.send("Question")
        self.assertEqual(error.exception.status_code, 409)
        saved = conversations.get_conversation(self.conversation.id, limit=20, offset=0)
        self.assertEqual(saved.total, 1)
        self.assertEqual(len(saved.turns), 1)

    def edit(self, question, turn):
        return conversations.send_message(
            self.conversation.id, MessageRequest(question=question, replace_turn=turn)
        )

    def questions(self):
        saved = conversations.get_conversation(self.conversation.id, limit=20, offset=0)
        return saved.total, [turn.response.question for turn in saved.turns]

    def test_editing_the_last_question_replaces_it_and_answers_from_the_turns_before(self):
        with patch.object(conversations, "search_document", side_effect=self.retrieve):
            with patch.object(
                conversations, "generate_answer", side_effect=self.answer
            ) as generator:
                self.send("First")
                self.send("Secnd")
                edited = self.edit("Second", 2)
        self.assertEqual(edited.turn_number, 2)
        self.assertEqual(self.questions(), (2, ["First", "Second"]))
        # The replaced turn is not part of the context its replacement is answered from.
        self.assertEqual(
            [item["question"] for item in generator.call_args.kwargs["history"]], ["First"]
        )

    def test_editing_an_earlier_question_drops_every_turn_after_it(self):
        with patch.object(conversations, "search_document", side_effect=self.retrieve):
            with patch.object(conversations, "generate_answer", side_effect=self.answer):
                for question in ("One", "Two", "Three"):
                    self.send(question)
                self.edit("Uno", 1)
                self.assertEqual(self.questions(), (1, ["Uno"]))
                # Numbering carries on from the edited turn.
                self.assertEqual(self.send("Dos").turn_number, 2)
        self.assertEqual(self.questions(), (2, ["Uno", "Dos"]))

    def test_a_failed_edit_leaves_the_conversation_as_it_was(self):
        with patch.object(conversations, "search_document", side_effect=self.retrieve):
            with patch.object(conversations, "generate_answer", side_effect=self.answer):
                self.send("One")
                self.send("Two")
            with patch.object(
                conversations, "generate_answer", side_effect=ConfigurationError("private")
            ):
                with self.assertRaises(AppError) as error:
                    self.edit("Changed", 1)
        self.assertEqual(error.exception.status_code, 503)
        self.assertEqual(self.questions(), (2, ["One", "Two"]))

    def test_editing_a_turn_that_does_not_exist_is_a_conflict(self):
        with patch.object(conversations, "search_document", side_effect=self.retrieve):
            with patch.object(conversations, "generate_answer", side_effect=self.answer):
                self.send("One")
                with self.assertRaises(AppError) as error:
                    self.edit("Changed", 5)
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(self.questions(), (1, ["One"]))

    def test_an_edit_is_refused_if_the_conversation_changed_while_it_was_answered(self):
        with patch.object(conversations, "search_document", side_effect=self.retrieve):
            with patch.object(conversations, "generate_answer", side_effect=self.answer):
                self.send("One")
                self.send("Two")

            def meanwhile(retrieval, *, history):
                # Another request adds a turn while this edit is being answered.
                with patch.object(conversations, "generate_answer", side_effect=self.answer):
                    self.send("Three")
                return self.answer(retrieval, history=history)

            with patch.object(conversations, "generate_answer", side_effect=meanwhile):
                with self.assertRaises(AppError) as error:
                    self.edit("Changed", 2)
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(self.questions(), (3, ["One", "Two", "Three"]))

    def test_unknown_conversation_makes_no_provider_calls_and_delete_cascades(self):
        with patch.object(conversations, "search_document") as retrieval:
            with self.assertRaises(AppError) as error:
                conversations.send_message(uuid4(), SearchRequest(question="Q"))
            self.assertEqual(error.exception.status_code, 404)
            retrieval.assert_not_called()
        with patch.object(conversations, "search_document", side_effect=self.retrieve):
            with patch.object(conversations, "generate_answer", side_effect=self.answer):
                self.send("Q")
        with Session(engine) as session:
            session.execute(delete(Document).where(Document.id == self.document_id))
            session.commit()
            self.assertIsNone(session.get(Conversation, self.conversation.id))
            self.assertEqual(
                session.scalars(
                    select(ConversationTurn).where(
                        ConversationTurn.conversation_id == self.conversation.id
                    )
                ).all(),
                [],
            )

    def test_documents_list_their_conversations_newest_first_with_turn_counts(self):
        newer = conversations.create_conversation(self.document_id)
        with patch.object(conversations, "search_document", side_effect=self.retrieve):
            with patch.object(conversations, "generate_answer", side_effect=self.answer):
                self.send("Which backend framework?")
        listing = conversations.list_conversations(self.document_id)
        self.assertEqual(listing.total, 2)
        self.assertEqual([item.id for item in listing.items], [newer.id, self.conversation.id])
        self.assertEqual([item.turn_count for item in listing.items], [0, 1])
        page = conversations.list_conversations(self.document_id, limit=1, offset=1)
        self.assertEqual([item.id for item in page.items], [self.conversation.id])
        self.assertEqual((page.total, page.limit, page.offset), (2, 1, 1))

    def test_has_turns_skips_conversations_that_were_never_answered(self):
        conversations.create_conversation(self.document_id)
        with patch.object(conversations, "search_document", side_effect=self.retrieve):
            with patch.object(conversations, "generate_answer", side_effect=self.answer):
                self.send("Which backend framework?")
        listing = conversations.list_conversations(self.document_id, has_turns=True)
        self.assertEqual(listing.total, 1)
        self.assertEqual(listing.items[0].id, self.conversation.id)

    def test_listing_an_unknown_document_is_not_found(self):
        with self.assertRaises(AppError) as error:
            conversations.list_conversations(uuid4())
        self.assertEqual(error.exception.status_code, 404)
