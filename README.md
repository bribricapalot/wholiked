# WhoGooned?

Multiplayer-Partyspiel: Jeder lädt seinen TikTok-Datenexport hoch, das Spiel zieht daraus die Likes, und alle raten, wer welches Video geliked hat.

## Likes reinholen

1. TikTok → Profil → ☰ → **Einstellungen und Datenschutz → Konto → Deine Daten herunterladen**
2. Format **JSON**, mindestens **Aktivität** auswählen → anfordern. Die Bereitstellung dauert Minuten bis Stunden, also **vor dem Spieleabend** anfordern.
3. ZIP herunterladen und in der Lobby auf das 📦-Feld ziehen.

Die Datei wird nur im Browser gelesen. Der Server bekommt nur bis zu 500 Video-Links aus den Likes, keine Nachrichten und keinen Verlauf.
Alternativ lassen sich einzelne Links einfügen.

- **Frontend**: React 19 + Vite + Tailwind v4 + Motion (`web/`)
- **Backend**: Node + Express 5 + Socket.io (`server/`)
- **State**: Redis (oder In-Memory-Fallback), alles mit TTL, nichts persistent
- **Shared**: typisierte Socket-Events (`shared/`)

Architektur, Event-Schema und Redis-Layout stehen in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Start (Entwicklung)

Voraussetzung: Node.js ≥ 20.

```bash
npm install
cp .env.example .env   # optional
npm run dev            # API :3001 + Web :5173
```

Dann <http://localhost:5173> öffnen. Zum Testen allein: in der Lobby **Bots** hochstellen (die spielen mit Demo-Videos).
Für mehrere Spieler an einem Rechner einfach mehrere Tabs öffnen (jeder Tab ist ein eigener Spieler).

> **Windows-Hinweis:** Falls `node -v` eine uralte Version zeigt (z. B. v6 aus Brackets), steht diese im PATH vor Node LTS.
> `.claude/dev.cmd` umgeht das. Dauerhaft hilft es, `C:\Program Files\nodejs` im PATH nach oben zu schieben.

## TikTok-Login (optional)

1. App auf <https://developers.tiktok.com> anlegen, **Login Kit** aktivieren, Scopes `user.info.basic` + `video.list`.
2. Redirect-URI eintragen: `http://localhost:5173/auth/tiktok/callback`.
3. `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` in `.env` setzen.
4. Bis zum App-Review funktionieren nur Accounts, die im Sandbox-Modus als Tester eingetragen sind.

**Wichtig:** Die TikTok-API gibt **keine gelikten Videos** heraus, nur die eigenen Posts. Likes kommen daher
über eingefügte Share-Links ins Spiel. OAuth liefert Avatar/Name und optional die eigenen Posts.

## Produktion

```bash
npm run build
NODE_ENV=production SESSION_SECRET=… REDIS_URL=redis://… TIKTOK_REDIRECT_URI=https://deine-domain/auth/tiktok/callback npm start
```

Der Server liefert `web/dist` selbst aus (gleiche Origin für Cookie und Socket). Momentan läuft alles auf **einer Instanz**,
weil die Rundentimer im Prozess laufen. Für mehrere Instanzen siehe Abschnitt 3 in der Architektur-Doku.

## Scripts

| | |
|---|---|
| `npm run dev` | Server (tsx watch) + Vite parallel |
| `npm test` | Scoring-Unit-Tests |
| `npm run typecheck` | TS für Server und Web |
| `npm run build` | Web-Bundle + Server-Bundle (esbuild) |
