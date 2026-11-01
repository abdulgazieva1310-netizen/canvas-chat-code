# Interview Mirror

Interview preparation with a FastAPI backend and React frontend. Product scope
is in [docs/plan.md](docs/plan.md); the API contract is [openapi.yaml](openapi.yaml).

## Local setup

Prerequisites: Python 3.11+, uv, Node.js 22+, npm, and Make. From a clean checkout,
install the exact locked dependencies (installation needs registry access):

```sh
make install
cd frontend
npm ci
```

Start the backend from the repository root:

```sh
make run
```

To use PostgreSQL instead of the default SQLite database, start the local
PostgreSQL 16 container:

```sh
docker run -d \
  --name interview-canvas-db \
  -e POSTGRES_USER=sdip \
  -e POSTGRES_PASSWORD=sdip \
  -e POSTGRES_DB=sdip \
  -p 5432:5432 \
  -v interview-canvas-pgdata:/var/lib/postgresql/data \
  postgres:16-alpine
```

Then run the backend with its PostgreSQL connection URL:

```sh
DATABASE_URL=postgresql+psycopg://sdip:sdip@localhost:5432/sdip make run
```

The backend applies database migrations at startup. To use PostgreSQL by
default, set the same `DATABASE_URL` in `backend/.env`.

Start the frontend in a second terminal:

```sh
cd frontend
npm run dev
```

The backend listens on port 8000; the frontend listens on port 8080. Backend
dependencies are managed by uv in `backend/pyproject.toml` and `backend/uv.lock`.
Frontend dependencies use `frontend/package.json` and `frontend/package-lock.json`.

## Tests

After installing dependencies, run the isolated baseline smoke tests from the root:

```sh
make smoke
```

These tests exercise a standalone ASGI application and React rendering, with no
application database, AI key, email adapter, or network request. The backend smoke
uses in-process ASGI transport; the frontend smoke renders only a local component.

Run the complete existing suites separately:

```sh
make test
cd frontend
npm test
```

Production frontend build: `cd frontend && npm run build`. See
[backend/README.md](backend/README.md) and [frontend/README.md](frontend/README.md)
for application configuration.

## AWS Deployment

The staging application is deployed in **eu-central-1**:

- Application: [https://in-c1bb18f9d10b4f6f8f8d17bd2d6bf303.ecs.eu-central-1.on.aws](https://in-c1bb18f9d10b4f6f8f8d17bd2d6bf303.ecs.eu-central-1.on.aws)
- Health endpoint: [https://in-c1bb18f9d10b4f6f8f8d17bd2d6bf303.ecs.eu-central-1.on.aws/api/health](https://in-c1bb18f9d10b4f6f8f8d17bd2d6bf303.ecs.eu-central-1.on.aws/api/health)

Push changes to `main` to start the GitHub Actions pipeline. It runs backend
and frontend tests, Docker Compose integration and browser E2E tests, and full
browser journeys in parallel. Once they pass, the deploy job builds the Docker
image, pushes it to the `interview-mirror` ECR repository, updates the
`interview-mirror-staging` CloudFormation stack, and checks the health endpoint.

The stack and ECR repository must already exist. In the GitHub repository,
configure the `AWS_DEPLOY_ROLE_ARN` Actions variable with the deploy role ARN.
The role must trust GitHub OIDC for this repository's `main` branch and have
the deployment permissions described in [docs/deployment.md](docs/deployment.md).
Do not add AWS access keys to GitHub; the workflow uses short-lived OIDC
credentials. See the deployment guide for role setup, permissions, and manual
CloudFormation deployment details.

## Docker Deployment

Build the Docker image from the repository root:

```sh
docker build -t interview-mirror .
```

Run the container and publish the application on port 8000. The named Docker
volume `interview-data` persists the SQLite database at `/app/backend/interview.db`
between container runs, including when `--rm` removes the container:

```sh
docker run --rm -p 8000:8000 -v interview-data:/app/backend interview-mirror
```

Open [http://localhost:8000](http://localhost:8000) to access the application. Press
`Ctrl+C` to stop the container.
