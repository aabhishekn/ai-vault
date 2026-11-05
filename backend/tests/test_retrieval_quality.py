"""Retrieval choices that decide how accurate answers are: fusing a follow-up's two searches,
covering every document when asked, ignoring repeated passages, and cleaning PDF text."""

from types import SimpleNamespace
from unittest.mock import patch
from uuid import NAMESPACE_DNS, uuid4, uuid5

import pytest

from app.ai.answer_generation import restore_accented_words
from app.processing.chunking import chunk_pages
from app.processing.pdf_extraction import ExtractedPage, clean_text
from app.schemas.chat import SearchRequest
from app.services import search


def hit(name, distance=0.1, text=None, document_id=None):
    node = SimpleNamespace(
        node_id=str(uuid5(NAMESPACE_DNS, name)),
        metadata={
            "cosine_distance": distance,
            "document_id": str(document_id or uuid4()),
            "chunk_index": 0,
            "page_number": 1,
        },
        get_content=lambda: text if text is not None else f"passage {name}",
    )
    return SimpleNamespace(node=node, name=name)


def ids(found):
    return [item.name for item in found]


def test_a_passage_found_by_both_searches_outranks_one_found_by_a_single_search():
    first = [hit("a"), hit("b"), hit("c")]
    second = [hit("x"), hit("c"), hit("y")]
    fused = search._fuse([first, second], 10)
    assert ids(fused)[0] == "c"
    assert set(ids(fused)) == {"a", "b", "c", "x", "y"}


def test_fusion_keeps_the_closest_distance_and_respects_the_limit():
    fused = search._fuse([[hit("a", 0.4)], [hit("a", 0.2), hit("b", 0.3)]], 1)
    assert ids(fused) == ["a"]
    assert fused[0].node.metadata["cosine_distance"] == 0.2


def test_a_first_question_is_searched_once_without_context():
    with (
        patch.object(search, "_embed_query", return_value=[0.0]) as embed,
        patch.object(search, "_retrieve", return_value=[hit("a")]) as retrieve,
    ):
        found = search._retrieve_for([uuid4()], "What is the CGPA?", None, 8)
    assert ids(found) == ["a"]
    assert retrieve.call_count == 1
    embed.assert_called_once_with("What is the CGPA?")


def test_a_follow_up_searches_the_bare_question_and_the_question_with_context():
    bare, contextual = [hit("bare1"), hit("bare2")], [hit("old1"), hit("old2")]
    with (
        patch.object(search, "_embed_query", return_value=[0.0]) as embed,
        patch.object(search, "_retrieve", side_effect=[bare, contextual]) as retrieve,
    ):
        found = search._retrieve_for([uuid4()], "How long was he at Tekion?", "Previous: Amazon", 4)
    asked = [call.args[1] for call in retrieve.call_args_list]
    assert asked[0] == "How long was he at Tekion?"
    assert asked[1].startswith("How long was he at Tekion?\n") and "Previous: Amazon" in asked[1]
    assert embed.call_count == 2
    # A change of subject still finds its own passages, not only the old topic's.
    assert {"bare1", "bare2", "old1", "old2"} == set(ids(found))


def test_a_follow_up_keeps_more_than_top_k_passages_since_two_searches_contributed():
    bare = [hit(f"b{i}") for i in range(4)]
    contextual = [hit(f"c{i}") for i in range(4)]
    with (
        patch.object(search, "_embed_query", return_value=[0.0]),
        patch.object(search, "_retrieve", side_effect=[bare, contextual]),
    ):
        found = search._retrieve_for([uuid4()], "q", "context", 4)
    assert len(found) == 6


@pytest.mark.parametrize(
    "question",
    [
        "Give me a one-sentence summary of each document.",
        "What do these documents have in common?",
        "Compare the two resumes",
        "How do they differ?",
        "Which dates are mentioned across the files?",
        "Summarise all the documents",
        "What do both say about Redis?",
    ],
)
def test_questions_about_every_document_are_recognised(question):
    assert search.asks_about_every_document(question)


@pytest.mark.parametrize(
    "question",
    [
        "What is Abhishek's CGPA?",
        "How long did he work at Tekion?",
        "List the Amazon leadership principles mentioned.",
        "What does Theom do?",
    ],
)
def test_specific_questions_are_not_treated_as_about_every_document(question):
    assert not search.asks_about_every_document(question)


def test_repeated_passages_take_one_slot():
    copy_a = hit("a", text="Same   text here.")
    copy_b = hit("b", text="same text here.")
    other = hit("c", text="Different")
    assert ids(search._without_repeats([copy_a, copy_b, other])) == ["a", "c"]


def _search_many(question):
    documents = [uuid4() for _ in range(3)]
    global_hits = [hit("g1", document_id=documents[0]), hit("g2", document_id=documents[0])]

    def per_document(document_id, text, vector, top_k):
        return [hit(f"{document_id}-{n}", document_id=document_id) for n in range(top_k)]

    with (
        patch.object(search, "require_searchable"),
        patch.object(search, "Session"),
        patch.object(search, "_embed_query", return_value=[0.0]),
        patch.object(search, "_retrieve_for", return_value=global_hits) as retrieve_for,
        patch.object(search, "passages_of_document", side_effect=per_document) as passages,
    ):
        result = search.search_documents(documents, SearchRequest(question=question))
    return documents, result, retrieve_for, passages


def test_asking_about_every_document_takes_each_documents_best_passages_only():
    documents, result, retrieve_for, passages = _search_many("Summarise each document")
    retrieve_for.assert_not_called()  # the whole-set search would let one document dominate
    assert passages.call_count == 3
    assert len(result.matches) == 3 * search.PASSAGES_PER_DOCUMENT
    # Grouped by document, in the order the documents were chosen.
    assert [
        match.document_id for match in result.matches[:: search.PASSAGES_PER_DOCUMENT]
    ] == documents


def test_a_specific_question_searches_all_documents_once():
    _, result, retrieve_for, passages = _search_many("What is the CGPA?")
    assert retrieve_for.call_count == 1
    passages.assert_not_called()
    assert len(result.matches) == 2


def test_a_nul_character_in_a_question_is_dropped():
    assert SearchRequest(question="Which B\x00rm company?").question == "Which Brm company?"
    with pytest.raises(ValueError):
        SearchRequest(question="\x00 \x00")


def test_ligatures_from_pdfs_become_plain_letters_in_chunks():
    chunks = chunk_pages([ExtractedPage(1, "Improved workﬂow eﬃciency and ﬁnancial reporting.")])
    assert chunks[0].text == "Improved workflow efficiency and financial reporting."


def test_passages_are_grouped_by_document_in_order_of_each_documents_best_passage():
    one, two = uuid4(), uuid4()
    found = [
        hit("a1", document_id=one),
        hit("b1", document_id=two),
        hit("a2", document_id=one),
        hit("b2", document_id=two),
    ]
    assert ids(search._grouped_by_document(found)) == ["a1", "a2", "b1", "b2"]


def test_accents_written_before_their_letter_are_joined():
    assert clean_text("B¨orm Bruckmeier, Z¨urich, caf´e") == "Börm Bruckmeier, Zürich, café"


def test_clean_text_leaves_ordinary_text_alone_and_drops_nul():
    text = 'Q3 plan: 5 < 6, C++ & "quotes" - 25%+ (see p. 3)'
    assert clean_text(text) == text
    assert clean_text("a\x00b") == "ab"


def test_chunks_keep_line_breaks_so_a_bullet_stays_under_its_heading():
    page = ExtractedPage(1, "Tekion  Dec 2025\n• Built APIs\n\n\nBörm Oct 2024\n• Built reminders")
    text = chunk_pages([page])[0].text
    assert text == "Tekion Dec 2025\n• Built APIs\nBörm Oct 2024\n• Built reminders"


SOURCE = "Software Developer at Börm Bruckmeier Infotech, Pune. Contact: José Álvarez."


@pytest.mark.parametrize("mangled", ["Bõrm", "Bőrm", "Bö rm", "Böhm", "Börrn", "Borm", "Brm"])
def test_a_name_the_model_mangled_is_restored_from_the_sources(mangled):
    answer = f"He worked at {mangled} Bruckmeier [1]."
    assert restore_accented_words(answer, [SOURCE]) == "He worked at Börm Bruckmeier [1]."


def test_correct_and_unrelated_words_are_left_alone():
    answer = "José Álvarez built the reminder service at Börm [1]. Borrowed ideas, 25% faster."
    assert restore_accented_words(answer, [SOURCE]) == answer


def test_sources_without_accents_change_nothing():
    answer = "Used Node.js and Bö rm."
    assert restore_accented_words(answer, ["Plain ASCII text only."]) == answer
