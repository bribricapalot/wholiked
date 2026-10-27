# WhoGooned? — Architektur

Source of truth für alle Payloads: [`shared/src/index.ts`](../shared/src/index.ts) (von Server und Client importiert).

## 0. Wichtige Plattform-Einschränkung

Die TikTok Display API (`video.list`) liefert **nur die eigenen, öffentlichen Posts** eines Users.
Gelikte/repostete Videos sind für Drittanbieter-Apps nicht abrufbar (nur über die Research API für
zugelassene Forschung). Deshalb:

| Quelle | Wie | Badge |
|---|---|---|
| **Alle Likes (Hauptweg)** | TikTok-Datenexport (DSGVO, „Deine Daten herunterladen“) als ZIP/JSON/TXT hochladen. Wird **nur im Browser** geparst (`web/src/lib/tiktokExport.ts`); an den Server gehen nur bis zu 500 zufällige Video-Links aus den neuesten 1500 Likes (+ optional Favoriten/Reposts) | 📦 |
| Einzelne gelikte Videos | Spieler fügen TikTok-Share-Links ein (`vm.tiktok.com/…`, `tiktok.com/@u/video/…`) | ❤️ |
| Eigene Posts | TikTok-OAuth (`user.info.basic`, `video.list`) → Import | 📤 |
| Fallback | Bots mit kuratiertem Demo-Pool (`server/src/game/demoPool.ts`) | 🤖 |

### Gelöschte Videos erkennen

TikToks oEmbed antwortet von Servern aus für existierende **und** nicht existierende IDs gleich (HTTP 200, ohne Autor/Thumbnail),
die Embed-Seiten ebenso. Eine serverseitige Prüfung ist also nicht zuverlässig. Der Server sortiert nur bei explizitem 4xx aus;
ansonsten erkennt der Player im Browser den Fehler (postMessage `onError`), oder der Host drückt „Überspringen“.

## 1. State Machine

```
LOBBY ──game:start──▶ COLLECTING ──deck ready──▶ ROUND_ACTIVE ──timer / all voted──▶ ROUND_REVEAL
  ▲                       │ (deck leer)                ▲                                  │ round:next / 12s
  │                       ▼                            │                                  ▼
  └──game:restart── GAME_OVER ◀──letzte Runde── LEADERBOARD ◀────────────────────────────┘
                                                       │ round:next / 10s
                                                       └──────────▶ ROUND_ACTIVE (n+1)
```

Spielerstatus: `CONNECTED` · `READY` · `FETCHING_LIKES` · `GUESSING` · `SPECTATING` (+ `connected: boolean`).

## 2. WebSocket Event Schema

Alle Client→Server-Events nutzen Socket.io-Acks: `{ ok: true, ...result } | { ok: false, error: string }`.

### Client → Server

| Event | Payload | Ack-Result | Wer |
|---|---|---|---|
| `room:create` | `{ name }` | `JoinResult` | alle |
| `room:join` | `{ roomCode, name, playerId?, playerToken? }` | `JoinResult` | alle (mit Token = Rejoin) |
| `room:leave` | – | – | Spieler |
| `room:settings` | `Partial<RoomSettings>` | – | Host, nur LOBBY |
| `room:kick` | `{ playerId }` | – | Host |
| `player:ready` | `{ ready }` | – | Spieler |
| `player:submitLinks` | `{ urls: string[] }` | `{ accepted, rejected[{url,reason}], total }` | LOBBY |
| `player:submitLinks` (Export) | `{ urls, source: "export" }` | wie oben, ersetzt vorherigen Export, max. 500 | LOBBY |
| `player:clearExport` | – | `{ total }` | LOBBY |
| `player:removeVideo` | `{ videoId }` | `{ total }` | LOBBY |
| `player:listVideos` | – | `{ videos: VideoSubmission[] }` | nur eigene |
| `player:linkTikTok` | – (Session-Cookie) | `{ name, avatarUrl }` | nach OAuth |
| `player:importTikTok` | – | `{ imported, total }` | LOBBY |
| `game:start` | – | – | Host, alle bereit |
| `vote:submit` | `{ roundIndex, targetPlayerId }` | – | eligible Voter, 1× pro Runde |
| `round:next` | – | – | Host (REVEAL→LEADERBOARD→nächste Runde) |
| `round:skip` | `{ roundIndex }` | – | Host; Video nicht abspielbar → Runde ohne Wertung verwerfen. Der Host-Client sendet das automatisch, wenn der TikTok-Player einen Fehler meldet |
| `game:restart` | – | – | Host, GAME_OVER |

```jsonc
// JoinResult
{ "roomCode": "G7K9", "playerId": "aB3…", "playerToken": "secret-for-rejoin", "state": PublicRoomState }

// PublicRoomState — wird bei JEDER Änderung als room:state gebroadcastet
{
  "code": "G7K9", "phase": "ROUND_ACTIVE", "hostId": "aB3…",
  "settings": { "roundSeconds": 20, "videosPerPlayer": 3, "allowSelfVote": false, "botCount": 0 },
  "players": [{ "id": "aB3…", "name": "Lena", "avatarUrl": null, "tiktokHandle": null, "isHost": true,
                "isBot": false, "status": "GUESSING", "connected": true, "score": 250,
                "videoCount": 5, "hasVoted": false }],
  "round": { "index": 2, "total": 9, "startedAt": 1761250000000, "endsAt": 1761250020000 },
  "serverNow": 1761250003120
}
```

### Server → Client

```jsonc
// round:start — enthält NIE den Owner
{
  "roundIndex": 2, "totalRounds": 9,
  "card": { "cardId": "x1y2", "kind": "tiktok", "videoId": "7312…", "embedUrl": "https://www.tiktok.com/player/v1/7312…?autoplay=1…",
            "shareUrl": "https://www.tiktok.com/@creator/video/7312…", "title": "…", "authorName": "creator",
            "thumbnailUrl": "…", "demo": null },
  "startedAt": 1761250000000, "endsAt": 1761250020000, "serverNow": 1761250000004,
  "eligibleVoterIds": ["p1", "p3"],      // Owner sitzen aus
  "candidateIds": ["p1", "p2", "p3"]
}

// round:voteProgress — nur Anzahl, nie wer wen gewählt hat
{ "roundIndex": 2, "voted": 1, "eligible": 2 }

// round:result
{
  "roundIndex": 2, "totalRounds": 9,
  "card": { /* wie oben */ "ownerPlayerId": "p2", "ownerHandle": "lena", "ownerAvatar": null, "ownerPlayerIds": ["p2"] },
  "ownerIds": ["p2"],
  "votes": [{ "voterId": "p1", "targetId": "p2", "correct": true, "points": 138, "speedBonus": 38, "elapsedMs": 4800 },
            { "voterId": "p3", "targetId": "p1", "correct": false, "points": 0, "speedBonus": 0, "elapsedMs": 9100 }],
  "ownerBonuses": [{ "playerId": "p2", "fooled": 1, "points": 50 }],
  "deltas": { "p1": 138, "p2": 50 },
  "scores": { "p1": 388, "p2": 150, "p3": 100 }
}

// leaderboard:update
{ "roundIndex": 2, "totalRounds": 9, "isFinal": false,
  "entries": [{ "playerId": "p1", "score": 388, "rank": 1, "delta": 138 }] }

// game:over
{ "podium": [/* top 3 LeaderboardEntry */], "entries": [/* alle */],
  "awards": [{ "key": "MASTER_GUESSER", "title": "Master Guesser", "description": "…", "playerId": "p1", "value": "6/8 richtig" }] }

// player:notice   { "type": "NO_VIDEOS" | "INFO" | "TIKTOK_REVOKED", "message": "…" }
// room:closed     { "reason": "…" }
```

### Scoring

- Richtig: **+100** + Speed-Bonus **+1…+50**, linear nach Restzeit beim Tipp
- Owner: **+50 pro getäuschtem Spieler**; wer gar nicht tippt, zählt nicht als getäuscht
- Mehrere Spieler mit demselben Video: alle sind Owner, jeder Owner-Tipp zählt als richtig

## 3. Redis-Datenstruktur

Alle Keys haben eine TTL (2h, sliding bei jeder Aktivität). Nichts landet auf Disk oder in einer DB.
Ohne `REDIS_URL` nutzt der Server `MemoryKV` mit derselben Semantik.

| Key | Typ | Inhalt | Lebensdauer |
|---|---|---|---|
| `wg:room:{CODE}` | STRING (JSON) | `RoomRecord`: Phase, Host, Settings, Spieler (inkl. `tokenHash`, Score, Stats), aktuelle Runde (`ownerIds`, `eligibleVoterIds`, `votedIds`) | 2h sliding; gelöscht bei Raumschließung |
| `wg:room:{CODE}:subs` | HASH | `playerId → VideoSubmission[]` (eingereichte Links) | 2h sliding; gelöscht bei Raumschließung |
| `wg:room:{CODE}:deck` | STRING (JSON) | `DeckCard[]`, gemischtes Master-Deck | erstellt bei `game:start`, **gelöscht bei GAME_OVER** |
| `wg:room:{CODE}:votes:{n}` | HASH | `playerId → {targetId, at}`, `HSETNX` = genau 1 Vote | gelöscht nach Reveal |
| `wg:sess:{SID}` | STRING | AES-256-GCM-verschlüsselt: TikTok-Profil + Tokens | 2h sliding; Tokens werden **bei GAME_OVER widerrufen** und entfernt |
| `wg:oauth:{STATE}` | STRING (JSON) | PKCE-Verifier, SID, returnTo | 10 min, single-use |
| `wg:oembed:{VIDEO_ID}` | STRING (JSON) | oEmbed-Metadaten / Negative-Cache | 2h |

Konsistenz: Mutationen pro Raum laufen über eine In-Process-Queue (load → mutate → save → broadcast).
Für horizontales Scaling bräuchte man den Socket.io-Redis-Adapter plus einen verteilten Lock (z. B. Redlock)
oder Lua-Skripte, und die Timer müssten in eine Redis-basierte Delayed Queue wandern.

## 4. Frontend-Komponentenbaum

```
<GameProvider>                         hooks/useGame.tsx: Socket, State, Clock-Offset, Toasts
└─ <App>                               Phasen-Router + AnimatePresence-Seitenübergänge
   ├─ <Toasts/>
   ├─ <HomeView/>                      Name, Code beitreten, Raum erstellen
   ├─ <LobbyView>
   │  ├─ <RoomCodeBadge/>              Code + Share-/Copy-Link
   │  ├─ <PlayerList/>                 Avatar, StatusBadge, Video-Anzahl, Kick (Host)
   │  ├─ <HostSettingsPanel/>          Slider (Zeit, Videos/Spieler, Bots), Self-Vote-Toggle
   │  ├─ <VideoSubmissionPanel/>       Links einfügen, TikTok verbinden/importieren, eigene Liste
   │  └─ Ready-/Start-Leiste
   ├─ <CollectingView/>                Deck wird gemischt, Status pro Spieler
   ├─ <RoundView>
   │  ├─ Header: Runde, <TimerBar/>, Countdown (server-synchronisiert)
   │  ├─ <VideoPlayerView/>            TikTok-Embed-iframe (player/v1) | animierte Demo-Karte
   │  └─ <GuessingGrid/>               Spieler-Kacheln, Owner-Pokerface, Vote-Fortschritt
   ├─ <RevealView/>                    Owner-Reveal (Spring), eigenes Ergebnis, Vote-Liste, Owner-Bonus
   ├─ <LeaderboardView>
   │  └─ <LeaderboardList/>            Layout-animierte Rangliste mit +Delta-Chips
   └─ <GameOverView>
      ├─ <Podium/>                     2-1-3-Treppchen mit Avataren
      ├─ <AwardCard/> ×3               Master Guesser, Most Unique Taste, Speedrunner
      └─ <LeaderboardList/>
```

## 5. Sicherheit & Datenschutz

- **Zero Persistence**: ausschließlich KV mit TTL. Deck wird bei Spielende gelöscht, Tokens werden bei TikTok widerrufen (`/v2/oauth/revoke/`), der Raum wird nach Leerstand (3 min) oder 2h Inaktivität komplett entfernt.
- **Sessions**: Das Cookie enthält nur eine Zufalls-ID (`httpOnly`, `SameSite=Lax`, `Secure` in Prod), Inhalt AES-256-GCM-verschlüsselt.
- **OAuth**: `state` single-use und an die Session gebunden, PKCE (S256, Encoding konfigurierbar), `returnTo`-Whitelist.
- **Rejoin**: `playerToken` (192 bit) wird nur als SHA-256 gespeichert und per timing-safe Compare geprüft.
- **Rate Limits**: Token-Bucket pro Upstream (TikTok API 5 req/s, oEmbed 8 req/s, Retry bei 429/5xx mit `Retry-After`), Token-Bucket pro Socket (10/s), Fixed-Window pro IP auf `/auth/*`.
- **SSRF**: Short-Link-Auflösung folgt Redirects nur auf TikTok-Hosts.
- **Fairness**: Owner werden erst im `round:result` gesendet, Votes sind serverseitig privat, der Server prüft Zeitfenster und doppelte Votes.
