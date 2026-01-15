Llama Yields

This repo now has:
- backend/ (Node.js API + SQLite sync CLI)
- frontend/ (React + Vite + TypeScript)

Production setup
1) cd frontend
2) npm install
3) npm run build
4) cd ../backend
5) npm install
6) node src/cli.js sync --category Stablecoins --limit 200
7) node src/server.js --db ../data/llama.sqlite --web ../frontend/dist

Dev setup (single server)
1) cd frontend
2) npm install
3) cd ../backend
4) npm install
5) node src/cli.js sync --category Stablecoins --limit 200
6) npm run dev

Notes
- Dev mode uses Vite middleware inside the backend server.
- Build the frontend with npm run build and serve frontend/dist from the backend.
- The legacy python files and web/ have been removed.
