# Repository Guidelines

## Project Structure & Module Organization
- `backend/`: Rust API server (`axum` + `sqlx`) with modules in `src/routes`, `src/middleware`, and `src/db`.
- `frontend/`: React + TypeScript app (Vite). Main code lives in `src/pages`, `src/stores`, and `src/api`.
- `docker-compose.yml`: Runs both services together (`frontend` on `127.0.0.1:3000`, `backend` on `127.0.0.1:8000`).
- `main/`: mirror of the current scaffold. Unless a task explicitly targets it, make changes in the top-level `backend/` and `frontend/`.

## Build, Test, and Development Commands
- `docker compose up --build`: build and run full stack with local networking.
- `cargo run --manifest-path backend/Cargo.toml`: run backend only.
- `cargo test --manifest-path backend/Cargo.toml`: run backend tests.
- `npm ci --prefix frontend`: install frontend dependencies.
- `npm run dev --prefix frontend`: run frontend dev server (Vite).
- `npm run build --prefix frontend`: type-check and build frontend.
- `npm run lint --prefix frontend`: run ESLint for TS/React files.

## Coding Style & Naming Conventions
- TypeScript/React: 2-space indentation, no semicolons, `PascalCase` for components/pages (for example `Dashboard.tsx`), `camelCase` for stores/utilities (for example `authStore.ts`).
- Rust: follow `rustfmt` defaults (4-space indentation), `snake_case` modules/files, `PascalCase` types, and `Result`-based error flow.
- Keep modules focused: route handlers in `routes`, auth/session logic in `middleware`, persistence in `db`.

## Testing Guidelines
- Backend: prefer unit tests near modules (`#[cfg(test)]`) and integration tests under `backend/tests/`.
- Frontend: no test runner is configured yet; at minimum, run `npm run lint --prefix frontend` and document manual UI validation in PRs.
- Name tests by behavior (example: `login_rejects_invalid_password`).

## Commit & Pull Request Guidelines
- Current history uses short imperative messages and some Conventional Commit style (`feat(scope): ...`). Prefer clear, scoped subjects.
- Keep commits single-purpose; avoid mixing backend and frontend refactors unless tightly coupled.
- PRs should include: summary, linked issue (`#123`), validation steps/commands run, and screenshots for UI changes.

## Security & Configuration Tips
- Copy `.env.example` to `.env` and set a strong `JWT_SECRET` before running locally.
- Do not commit `.env`, runtime `data/`, or generated build artifacts.
- The backend bootstrap creates a default `admin/admin` user when the DB is empty; rotate credentials immediately in non-local environments.
