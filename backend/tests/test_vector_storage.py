import unittest
from uuid import uuid4

from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError, StatementError
from sqlalchemy.orm import Session

from app.db.database import engine
from app.db.models import Document, DocumentChunk
from tests.support import requires_database


@requires_database
class VectorStorageTests(unittest.TestCase):
    def setUp(self):
        self.session = Session(engine)
        self.addCleanup(self.session.close)
        self.identifier = uuid4()
        self.session.add(
            Document(
                id=self.identifier,
                filename="vector-test.pdf",
                storage_path=f"storage/documents/{self.identifier}.pdf",
                content_type="application/pdf",
                size_bytes=10,
            )
        )
        self.session.flush()

    def chunk(self, index, vector=None, model=None):
        return DocumentChunk(
            document_id=self.identifier,
            chunk_index=index,
            page_number=1,
            text="Test chunk",
            embedding=vector,
            embedding_model=model,
        )

    def test_vector_round_trip_and_cosine_ordering(self):
        query = [1.0] + [0.0] * 1535
        orthogonal = [0.0, 1.0] + [0.0] * 1534
        self.session.add_all(
            [
                self.chunk(0, orthogonal, "test-synthetic"),
                self.chunk(1, query, "test-synthetic"),
                self.chunk(2),
            ]
        )
        self.session.flush()
        self.session.expire_all()
        distance = DocumentChunk.embedding.cosine_distance(query)
        results = self.session.execute(
            select(DocumentChunk, distance.label("distance"))
            .where(
                DocumentChunk.document_id == self.identifier, DocumentChunk.embedding.is_not(None)
            )
            .order_by(distance)
        ).all()
        self.assertEqual([row[0].chunk_index for row in results], [1, 0])
        self.assertEqual(len(results[0][0].embedding), 1536)
        self.assertAlmostEqual(float(results[0][0].embedding[0]), 1.0)
        self.assertAlmostEqual(results[0][1], 0.0)
        self.assertAlmostEqual(results[1][1], 1.0)

    def test_vector_and_model_must_be_saved_together(self):
        for vector, model in [([1.0] + [0.0] * 1535, None), (None, "test-synthetic")]:
            with self.subTest(model=model):
                with self.assertRaises(IntegrityError):
                    with self.session.begin_nested():
                        self.session.add(self.chunk(0, vector, model))
                        self.session.flush()

    def test_wrong_dimension_is_rejected(self):
        with self.assertRaises(StatementError):
            with self.session.begin_nested():
                self.session.add(self.chunk(0, [1.0, 0.0, 0.0], "test-synthetic"))
                self.session.flush()
        with self.assertRaises(StatementError):
            with self.session.begin_nested():
                self.session.execute(
                    text(
                        "INSERT INTO document_chunks (id, document_id, chunk_index, page_number, text, embedding, embedding_model) VALUES (:id, :document_id, 0, 1, 'Test', '[1,0,0]'::vector, 'test-synthetic')"
                    ),
                    {"id": uuid4(), "document_id": self.identifier},
                )
