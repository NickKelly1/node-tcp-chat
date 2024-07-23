# What is this

This is a minimalistic 0 dependency NodeJS terminal TCP chat app.

The purpose is to demonstrate working with ANSI escape codes (so that I can remember how to use them).

## Getting Started

```sh
nvm use
pnpm install
cp .env.example .env
node --run build
# for continuous rebuilding: node --run build:watch
```

```sh
# Terminal 1 (server)
nvm use
node --run start:server
```

```sh
# Terminal 2 (client)
nvm use
node --run start:client
```

```sh
# Terminal 3 (client)
nvm use
node --run start:client
```

Start typing into terminal 2 and 3

