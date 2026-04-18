# Error Handling

## Format
All errors use:
```json
{
  "error": {
    "code": "snake_case_error_code",
    "message": "Human-readable description",
    "details": {}
  }
}
```

## Standard Codes
| Status | Code | Usage |
|--------|------|-------|
| 400 | validation_error | Invalid input. Include `details.fields` with per-field errors |
| 404 | not_found | Resource doesn't exist |
| 409 | conflict | Duplicate or business rule conflict (e.g. duplicate product name, insufficient stock) |
| 500 | internal_error | Unexpected failure |

## Validation Error Example
```json
{
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": {
      "fields": [
        { "field": "name", "message": "is required" },
        { "field": "price", "message": "must be a non-negative number" }
      ]
    }
  }
}
```

## Rules
- Never expose SQL errors or internal details to the caller
- Use log.write to record internal errors for debugging
- Soft-deleted resources should return 404 (not reveal they exist)
