## Multibuzzer

A simple, real-time multiplayer buzzer system perfect for quiz bowls, trivia nights, classrooms, and more.

This is a dockerized version of [https://github.com/wsun/multibuzzer](https://github.com/wsun/multibuzzer) with advanced security hardening.

Built using Create React App, boardgame.io, and containerized for isolated execution environments.

### Security Hardening Features

- **Read-Only Root Filesystem**: Prevents any write operations within the container filesystem.
- **Dropped Linux Capabilities**: Drops all capabilities (`cap_drop: [ALL]`) to prevent privileged operations.
- **Non-Root Execution**: Runs under a dedicated, unprivileged `node` user account.
- **In-Memory Temporary Paths (`tmpfs`)**: Mounts `/tmp` and `/run` to RAM to support required OS writes without exposing disk storage.

---

### Development & Deployment

The application is fully containerized using Docker and Docker Compose.

#### Prerequisites

- Docker and Docker Compose

#### Clone the Repository

Clone the repository to your local machine:

```bash
git clone https://github.com/iitaauk/multibuzzer.git
cd multibuzzer
```

#### Build the Container

Build the Docker image containing the compiled production frontend assets and the backend server:

```bash
docker compose build
```

#### Run the Application

Start the containerized application in the background:

```bash
docker compose up -d
```

The application will be accessible at [http://localhost:4001](http://localhost:4001) on your host machine.

#### Stop the Application

To stop and remove the running container:

```bash
docker compose down
```

#### View Application Logs

To view logs from the running container:

```bash
docker compose logs -f
```
