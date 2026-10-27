import type { DemoVisual } from '@whogooned/shared';

/**
 * Fallback deck for bots (and for testing without TikTok). These are rendered as
 * animated cards in the client. To use real videos instead, add TikTok share URLs
 * to DEMO_TIKTOK_URLS — they are validated via oEmbed like player links.
 */
export const DEMO_TIKTOK_URLS: string[] = [];

export const DEMO_CARDS: DemoVisual[] = [
  { emoji: '🐈', caption: 'Katze vs. Gurke – Teil 47', gradient: ['#ff4d6d', '#ffb347'] },
  { emoji: '🍝', caption: 'Pasta-Hack, den Nonna hassen würde', gradient: ['#f7971e', '#ffd200'] },
  { emoji: '🕺', caption: 'Der Tanz, den gerade alle machen', gradient: ['#8e2de2', '#4a00e0'] },
  { emoji: '🧼', caption: 'Satisfying Teppichreinigung (17 Min.)', gradient: ['#00c6ff', '#0072ff'] },
  { emoji: '🐶', caption: 'Hund hört zum ersten Mal Dubstep', gradient: ['#f953c6', '#b91d73'] },
  { emoji: '🏋️', caption: '„Nur noch ein Satz“ – Gym-POV', gradient: ['#11998e', '#38ef7d'] },
  { emoji: '🤯', caption: 'Fun Fact, der dein Leben ändert', gradient: ['#fc466b', '#3f5efb'] },
  { emoji: '🎮', caption: 'Speedrun-Glitch in 0,3 Sekunden', gradient: ['#1d2b64', '#f8cdda'] },
  { emoji: '🍜', caption: 'Mukbang um 3 Uhr nachts', gradient: ['#ee0979', '#ff6a00'] },
  { emoji: '🧙', caption: 'Wenn der DM einen Nat 1 würfelt', gradient: ['#654ea3', '#eaafc8'] },
  { emoji: '🚗', caption: 'Einparken mit Mama auf dem Beifahrersitz', gradient: ['#ff512f', '#dd2476'] },
  { emoji: '🌱', caption: 'Pflanzen-Timelapse über 90 Tage', gradient: ['#56ab2f', '#a8e063'] },
  { emoji: '💅', caption: 'Get Ready With Me: Zahnarzttermin', gradient: ['#f78ca0', '#fe9a8b'] },
  { emoji: '🦆', caption: 'Ente folgt Mann durch ganz Berlin', gradient: ['#2193b0', '#6dd5ed'] },
  { emoji: '🎤', caption: 'Karaoke-Fail mit Standing Ovations', gradient: ['#c94b4b', '#4b134f'] },
  { emoji: '📦', caption: 'Unboxing von etwas völlig Nutzlosem', gradient: ['#e65c00', '#f9d423'] },
  { emoji: '🧠', caption: 'Wie ich meine Bildschirmzeit halbiert habe (Lüge)', gradient: ['#4776e6', '#8e54e9'] },
  { emoji: '🐸', caption: 'Frosch-ASMR. Einfach Frosch-ASMR.', gradient: ['#0f9b0f', '#00d2ff'] },
  { emoji: '👵', caption: 'Oma reagiert auf aktuelle Slang-Wörter', gradient: ['#da22ff', '#9733ee'] },
  { emoji: '🍕', caption: 'Ananas-Pizza Ranking (kontrovers)', gradient: ['#ff9966', '#ff5e62'] },
  { emoji: '🛹', caption: 'Erster Kickflip nach 400 Versuchen', gradient: ['#232526', '#7f8c8d'] },
  { emoji: '🧳', caption: 'Wie ich für 2 Wochen in einen Rucksack packe', gradient: ['#1fa2ff', '#a6ffcb'] },
  { emoji: '🎻', caption: 'Geige-Cover vom Nokia-Klingelton', gradient: ['#b24592', '#f15f79'] },
  { emoji: '🦖', caption: 'Dino-Kostüm im Büro – niemand sagt was', gradient: ['#3ca55c', '#b5ac49'] },
];

export const BOT_PROFILES = [
  { name: 'Bot Bella', emoji: '🤖' },
  { name: 'Bot Bruno', emoji: '👾' },
  { name: 'Bot Cleo', emoji: '🦾' },
  { name: 'Bot Dex', emoji: '🛸' },
];
