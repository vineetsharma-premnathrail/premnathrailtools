# Contributing Guide

Welcome to Premnathrail Portal! This guide explains how to contribute code.

## Setup

1. **Read docs:**
   - [ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md) — Understand the design
   - [SETUP.md](docs/setup/SETUP.md) — Get running locally

2. **Set up environment:**
   ```bash
   cd backend
   python -m venv venv && source venv/bin/activate  # macOS/Linux
   # or venv\Scripts\activate  # Windows
   pip install -r requirements.txt
   ```

3. **Verify setup:**
   ```bash
   uvicorn app.main:app --reload
   pytest app/tests -v
   ```

---

## Workflow

### 1. Pick a Task

From roadmap:
- Stage 7: CRM module
- Stage 8: Frontend
- Stage 10: ERP/RnD modules
- Or: Bug fixes, documentation, refactoring

### 2. Create Feature Branch

```bash
git checkout -b feature/crm-notes
```

Branch naming:
- `feature/...` — New feature
- `fix/...` — Bug fix
- `docs/...` — Documentation
- `refactor/...` — Refactoring

### 3. Implement

**Follow the pattern:**

#### Add a new endpoint: `POST /api/v1/crm/notes`

**Step 1: Model** (`app/modules/crm/models/note.py`)
```python
class Note(Base):
    __tablename__ = "crm_notes"
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str]
    description: Mapped[str]
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
```

**Step 2: Schemas** (`app/modules/crm/schemas/note.py`)
```python
class CreateNoteSchema(BaseModel):
    title: str
    description: str

class NoteResponse(BaseModel):
    id: int
    title: str
    description: str
```

**Step 3: Repository** (`app/modules/crm/repositories/note_repository.py`)
```python
class NoteRepository:
    def __init__(self, db: Session):
        self.db = db
    
    def create(self, title: str, description: str, user_id: int) -> Note:
        note = Note(title=title, description=description, user_id=user_id)
        self.db.add(note)
        self.db.commit()
        self.db.refresh(note)
        return note
```

**Step 4: Service** (`app/modules/crm/services/note_service.py`)
```python
class NoteService:
    def __init__(self, db: Session):
        self.db = db
        self.repo = NoteRepository(db)
    
    def create_note(self, user_id: int, data: CreateNoteSchema) -> NoteResponse:
        if not data.title:
            raise ValueError("Title required")
        note = self.repo.create(data.title, data.description, user_id)
        return NoteResponse.model_validate(note)
```

**Step 5: Route** (`app/modules/crm/routes/note.py`)
```python
@router.post("/", response_model=NoteResponse, status_code=201)
def create_note(
    data: CreateNoteSchema,
    user: User = Depends(get_current_user),
    service: NoteService = Depends(get_note_service)
):
    return service.create_note(user.id, data)
```

**Step 6: Test** (`app/modules/crm/tests/test_note_service.py`)
```python
def test_create_note_with_valid_data(service):
    """Test: Create note with valid data."""
    schema = CreateNoteSchema(title="Call", description="Follow up")
    result = service.create_note(1, schema)
    assert result.title == "Call"
    assert result.id is not None

def test_create_note_without_title_raises_error(service):
    """Test: Create note without title raises ValueError."""
    schema = CreateNoteSchema(title="", description="...")
    with pytest.raises(ValueError):
        service.create_note(1, schema)
```

**Step 7: Register route in main.py**
```python
from app.modules.crm.routes import note as note_routes
app.include_router(note_routes.router, prefix="/api/v1/crm")
```

### 4. Write Tests

- Every feature needs tests
- Run tests locally: `pytest app/tests -v`
- Minimum coverage: 80%

```bash
pytest app/tests --cov=app --cov-report=term-missing
```

### 5. Code Style

No hard rules — just be consistent:

✅ **Do:**
- Use descriptive variable names: `user_id` not `uid`
- Keep functions small (<50 lines)
- Use type hints: `def create(title: str) -> Note:`
- Comment the WHY, not the WHAT
- Docstring for public functions

❌ **Don't:**
- Use unclear abbreviations: `nts` vs `notes`
- Create massive functions (>100 lines)
- Skip type hints
- Leave debug code or print statements
- Over-comment obvious code

**Example:**

```python
def create_note(user_id: int, title: str, description: str) -> Note:
    """Create a new note for the user."""
    # Validate title is not empty (prevent silent failures)
    if not title.strip():
        raise ValueError("Note title cannot be empty")
    
    note = Note(title=title, description=description, user_id=user_id)
    self.db.add(note)
    self.db.commit()
    return note
```

### 6. Commit

```bash
git add app/modules/crm/models/note.py app/modules/crm/schemas/note.py ...
git commit -m "feat(crm): add note creation endpoint

- Add Note model with user_id foreign key
- Add CreateNoteSchema and NoteResponse schemas
- Add NoteRepository for database access
- Add NoteService with validation
- Add POST /api/v1/crm/notes endpoint
- Add unit tests for service layer

Closes #123"
```

**Commit message format:**
- Type: `feat`, `fix`, `docs`, `refactor`, `test`
- Scope: `(crm)`, `(auth)`, `(core)`
- Subject: Imperative mood, <50 chars
- Body: Explain WHAT and WHY (if needed)
- Footer: Reference issues/PRs: `Closes #123`

### 7. Push & Create Pull Request

```bash
git push origin feature/crm-notes
```

Then on GitHub/GitLab:
- Create Pull Request
- Link to issue
- Describe changes
- Request review

**PR Title:** Same as commit message
```
feat(crm): add note creation endpoint
```

**PR Description:**
```markdown
## Summary
Added ability to create CRM notes via API.

## Changes
- Note model with ORM mapping
- Request/response schemas
- Repository for DB access
- Service with business logic
- API endpoint: POST /api/v1/crm/notes
- Unit tests (80% coverage)

## Testing
- All tests pass: `pytest app/tests -v`
- Tested via Swagger UI at /docs
- Database: fresh PostgreSQL

## Related
Closes #123
```

### 8. Review & Merge

- At least 1 code review
- All tests must pass
- No merge conflicts
- Then merge to main

---

## Code Review Checklist

When reviewing others' code:

- [ ] Does it follow the layer pattern? (routes → services → repos)
- [ ] Are there tests?
- [ ] Do the tests pass?
- [ ] Is the code readable?
- [ ] Are there comments for WHY (not WHAT)?
- [ ] Are there any security issues?
- [ ] Is database schema correct?
- [ ] Are there N+1 query issues?
- [ ] Is error handling adequate?

---

## Common Mistakes

### ❌ Putting business logic in routes

```python
# Bad
@router.post("/notes")
def create_note(data: CreateNoteSchema, db: Session = Depends(get_db)):
    if not data.title:  # ← Business logic in route!
        raise HTTPException(status_code=400)
    note = Note(title=data.title)
    db.add(note)
    db.commit()
    return note
```

```python
# Good
@router.post("/notes", response_model=NoteResponse)
def create_note(
    data: CreateNoteSchema,
    service: NoteService = Depends(get_note_service)
):
    return service.create_note(data)  # ← Service has the logic
```

### ❌ Querying database in service without repository

```python
# Bad
class NoteService:
    def create(self, data: CreateNoteSchema):
        note = Note(...)
        self.db.add(note)  # ← Direct DB access in service!
        self.db.commit()
```

```python
# Good
class NoteService:
    def create(self, data: CreateNoteSchema):
        note = self.repo.create(...)  # ← Via repository
```

### ❌ No tests

```python
# Bad: No tests
# → Nobody knows if it works
# → Hard to refactor later
```

```python
# Good: Always test
def test_create_note_validates_title():
    ...
```

---

## Debugging Tips

### Print debug info
```python
print(f"Debug: {variable}")  # Remove before committing!
```

### Use debugger
```python
import pdb; pdb.set_trace()  # Pause execution, inspect
# Then: n (next), s (step), c (continue), l (list)
```

### Check logs
```bash
uvicorn app.main:app --reload --log-level=debug
```

### Run specific test with output
```bash
pytest app/tests/test_note.py::test_create -vvv -s
```

---

## Getting Help

1. **Documentation** — Check `docs/` and README
2. **Existing code** — Look at similar features (e.g., auth module)
3. **Tests** — Tests show expected behavior
4. **Ask team** — Slack, PR comments, etc.

---

## Checklist Before Submitting PR

- [ ] Code follows layer pattern (routes → services → repos)
- [ ] All new code has tests
- [ ] Tests pass locally: `pytest app/tests -v`
- [ ] No debug code or print statements
- [ ] Commit message is descriptive
- [ ] PR description explains changes
- [ ] No conflicts with main branch
- [ ] Code style is consistent
- [ ] No security issues

---

## Deployment

Merged code goes through:
1. **Staging** — Test in production-like environment
2. **Manual testing** — QA team verifies
3. **Production** — Deploy to live servers

Your PR will be deployed! Make sure it's solid. 💪

---

**Questions?** Ask the team!
