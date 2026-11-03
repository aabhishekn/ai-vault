from pathlib import Path
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, Query, UploadFile
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from database import engine
from models import Document
from schemas import DocumentListResponse, DocumentResponse

router = APIRouter(prefix="/documents", tags=["documents"])
STORAGE_DIR = Path(__file__).resolve().parent.parent / "storage" / "documents"
MAX_UPLOAD_BYTES = 10 * 1024 * 1024


@router.post("", response_model=DocumentResponse, status_code=201)
def upload_document(file: UploadFile) -> DocumentResponse:
    filename = (file.filename or "").replace("\\", "/").rsplit("/", 1)[-1]
    if not filename or len(filename) > 255:
        raise HTTPException(400, "A filename of at most 255 characters is required")
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(415, "Only PDF files are supported")

    document_id = uuid4()
    destination = STORAGE_DIR / f"{document_id}.pdf"
    size = 0
    created = False
    committed = False
    try:
        header = file.file.read(5)
        if not header:
            raise HTTPException(400, "The uploaded file is empty")
        if header != b"%PDF-":
            raise HTTPException(415, "The file must have a PDF header")
        STORAGE_DIR.mkdir(parents=True, exist_ok=True)
        with destination.open("xb") as output:
            created = True
            output.write(header)
            size = len(header)
            while chunk := file.file.read(64 * 1024):
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(413, "PDF must be 10 MiB or smaller")
                output.write(chunk)

        with Session(engine) as session:
            document = Document(
                id=document_id, filename=filename,
                storage_path=str(destination.relative_to(STORAGE_DIR.parent.parent)),
                content_type="application/pdf", size_bytes=size,
            )
            session.add(document)
            session.flush()
            response = DocumentResponse.model_validate(document)
            session.commit()
            committed = True
        return response
    except SQLAlchemyError:
        raise HTTPException(503, "Unable to save document metadata") from None
    except OSError:
        raise HTTPException(500, "Unable to save uploaded file") from None
    finally:
        if created and not committed:
            destination.unlink(missing_ok=True)


@router.get("/{document_id}", response_model=DocumentResponse)
def get_document(document_id: UUID) -> DocumentResponse:
    try:
        with Session(engine) as session:
            document = session.get(Document, document_id)
            if document is None:
                raise HTTPException(404, "Document not found")
            return DocumentResponse.model_validate(document)
    except SQLAlchemyError:
        raise HTTPException(503, "Unable to retrieve document metadata") from None


@router.get("", response_model=DocumentListResponse)
def list_documents(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> DocumentListResponse:
    try:
        with Session(engine) as session:
            total = session.scalar(select(func.count()).select_from(Document))
            documents = session.scalars(
                select(Document)
                .order_by(Document.created_at.desc(), Document.id.desc())
                .limit(limit)
                .offset(offset)
            ).all()
            return DocumentListResponse(
                items=[DocumentResponse.model_validate(doc) for doc in documents],
                total=total, limit=limit, offset=offset,
            )
    except SQLAlchemyError:
        raise HTTPException(503, "Unable to list documents") from None
