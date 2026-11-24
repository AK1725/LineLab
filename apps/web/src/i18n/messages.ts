/**
 * UI strings by locale (i18n scaffolding, BLUEPRINT §6). English is complete; other locales
 * cover what's translated so far and fall back to English key by key.
 */
export const en = {
  "nav.build": "Build",
  "nav.tracks": "Tracks",
  "nav.components": "Components",
  "nav.gallery": "Gallery",
  "nav.learn": "Learn",
  "nav.signIn": "Sign in",
  "nav.signOut": "Sign out",
  "home.kicker": "Open source · runs in your browser",
  "home.tagline":
    "Design, wire, simulate and debug line-following robots: run your real firmware on a virtual track and see exactly where and why it fails.",
  "home.build": "Build a robot",
  "home.fromPhotos": "Start from photos",
  "home.gallery": "Browse the gallery",
  "home.learn": "Learn the basics",
  "home.features": "What you can do",
  "home.roadmap": "Roadmap",
  "home.done": "Done",
  "footer.language": "Language",
  "footer.offline": "Works offline once loaded. Your designs stay in this browser.",
} as const;

export type MessageKey = keyof typeof en;
export type Messages = Partial<Record<MessageKey, string>>;

export const es: Messages = {
  "nav.build": "Construir",
  "nav.tracks": "Pistas",
  "nav.components": "Componentes",
  "nav.gallery": "Galería",
  "nav.learn": "Aprender",
  "nav.signIn": "Iniciar sesión",
  "nav.signOut": "Cerrar sesión",
  "home.kicker": "Código abierto · funciona en tu navegador",
  "home.tagline":
    "Diseña, cablea, simula y depura robots seguidores de línea: ejecuta tu firmware real en una pista virtual y mira exactamente dónde y por qué falla.",
  "home.build": "Construir un robot",
  "home.fromPhotos": "Empezar desde fotos",
  "home.gallery": "Ver la galería",
  "home.learn": "Aprender lo básico",
  "home.features": "Qué puedes hacer",
  "home.roadmap": "Hoja de ruta",
  "home.done": "Hecho",
  "footer.language": "Idioma",
  "footer.offline":
    "Funciona sin conexión una vez cargado. Tus diseños se quedan en este navegador.",
};

export const LOCALES = { en: "English", es: "Español" } as const;
export type Locale = keyof typeof LOCALES;
export const MESSAGES: Record<Locale, Messages> = { en, es };
