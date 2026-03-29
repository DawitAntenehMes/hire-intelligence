"""
core/cv_parser.py — Extract plain text from an uploaded CV file.

Supported formats: PDF (.pdf), Word (.docx).
All parsing happens server-side — raw file bytes never leave the backend.
"""

from __future__ import annotations

import io

from fastapi import HTTPException, UploadFile


async def extract_text(upload: UploadFile) -> str:
    """
    Read the uploaded file and return its text content as a string.
    Raises HTTP 400 for unsupported file types.
    Raises HTTP 422 if the file cannot be parsed.
    """
    filename = (upload.filename or "").lower()
    content = await upload.read()

    if filename.endswith(".pdf"):
        return _parse_pdf(content)
    elif filename.endswith(".docx"):
        return _parse_docx(content)
    else:
        raise HTTPException(
            status_code=400,
            detail="Unsupported file type. Please upload a PDF or DOCX file.",
        )


def _parse_pdf(content: bytes) -> str:
    try:
        import pypdf  # lazy import — only required when a PDF is uploaded

        reader = pypdf.PdfReader(io.BytesIO(content))
        pages = [page.extract_text() or "" for page in reader.pages]
        text = "\n".join(pages).strip()
        if not text:
            raise HTTPException(
                status_code=422,
                detail="Could not extract text from the PDF. The file may be scanned or image-based.",
            )
        return text
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"PDF parsing error: {exc}") from exc


def _parse_docx(content: bytes) -> str:
    try:
        import docx  # lazy import — only required when a DOCX is uploaded

        doc = docx.Document(io.BytesIO(content))
        paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
        text = "\n".join(paragraphs).strip()
        if not text:
            raise HTTPException(
                status_code=422,
                detail="Could not extract text from the DOCX file.",
            )
        return text
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"DOCX parsing error: {exc}") from exc
