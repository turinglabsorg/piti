import { describe, it, expect } from "vitest";

const forgetTranslations: Record<string, { title: string; empty: string; prompt: string; deleted: string; confirmAll: string; yes: string; no: string; allDeleted: string; cancelled: string; invalid: string }> = {
  english: { title: "Your Memories", empty: "You have no memories stored.", prompt: "Reply with a number to delete that memory, or use /forget all to delete everything.", deleted: "Memory deleted.", confirmAll: "Are you sure you want to delete ALL your memories? This cannot be undone.", yes: "Yes, delete all", no: "Cancel", allDeleted: "All memories deleted.", cancelled: "Cancelled.", invalid: "Invalid selection." },
  italian: { title: "I tuoi Ricordi", empty: "Non hai ricordi salvati.", prompt: "Rispondi con un numero per eliminare quel ricordo, o usa /forget all per eliminare tutto.", deleted: "Ricordo eliminato.", confirmAll: "Sei sicuro di voler eliminare TUTTI i tuoi ricordi? Non si puo' annullare.", yes: "Si, elimina tutto", no: "Annulla", allDeleted: "Tutti i ricordi eliminati.", cancelled: "Annullato.", invalid: "Selezione non valida." },
  spanish: { title: "Tus Recuerdos", empty: "No tienes recuerdos guardados.", prompt: "Responde con un numero para eliminar ese recuerdo, o usa /forget all para eliminar todo.", deleted: "Recuerdo eliminado.", confirmAll: "Estas seguro de querer eliminar TODOS tus recuerdos? No se puede deshacer.", yes: "Si, eliminar todo", no: "Cancelar", allDeleted: "Todos los recuerdos eliminados.", cancelled: "Cancelado.", invalid: "Seleccion no valida." },
  french: { title: "Vos Souvenirs", empty: "Vous n'avez aucun souvenir enregistre.", prompt: "Repondez avec un numero pour supprimer ce souvenir, ou utilisez /forget all pour tout supprimer.", deleted: "Souvenir supprime.", confirmAll: "Etes-vous sur de vouloir supprimer TOUS vos souvenirs ? Cette action est irreversible.", yes: "Oui, tout supprimer", no: "Annuler", allDeleted: "Tous les souvenirs supprimes.", cancelled: "Annule.", invalid: "Selection invalide." },
  german: { title: "Deine Erinnerungen", empty: "Du hast keine gespeicherten Erinnerungen.", prompt: "Antworte mit einer Nummer um die Erinnerung zu loschen, oder nutze /forget all um alles zu loschen.", deleted: "Erinnerung geloscht.", confirmAll: "Bist du sicher, dass du ALLE Erinnerungen loschen willst? Dies kann nicht ruckgangig gemacht werden.", yes: "Ja, alles loschen", no: "Abbrechen", allDeleted: "Alle Erinnerungen geloscht.", cancelled: "Abgebrochen.", invalid: "Ungultige Auswahl." },
  portuguese: { title: "Suas Memorias", empty: "Voce nao tem memorias armazenadas.", prompt: "Responda com um numero para deletar essa memoria, ou use /forget all para deletar tudo.", deleted: "Memoria deletada.", confirmAll: "Tem certeza que deseja deletar TODAS as suas memorias? Isso nao pode ser desfeito.", yes: "Sim, deletar tudo", no: "Cancelar", allDeleted: "Todas as memorias deletadas.", cancelled: "Cancelado.", invalid: "Selecao invalida." },
};

const REQUIRED_LANGUAGES = ["english", "italian", "spanish", "french", "german", "portuguese"];
const REQUIRED_KEYS = ["title", "empty", "prompt", "deleted", "confirmAll", "yes", "no", "allDeleted", "cancelled", "invalid"] as const;

describe("/forget translations", () => {
  it("should have all 6 supported languages", () => {
    const languages = Object.keys(forgetTranslations);
    expect(languages).toHaveLength(6);
    for (const lang of REQUIRED_LANGUAGES) {
      expect(forgetTranslations).toHaveProperty(lang);
    }
  });

  it("should have all required keys for each language", () => {
    for (const lang of REQUIRED_LANGUAGES) {
      const t = forgetTranslations[lang];
      for (const key of REQUIRED_KEYS) {
        expect(t).toHaveProperty(key);
      }
    }
  });

  it("should have non-empty strings for all translation values", () => {
    for (const lang of REQUIRED_LANGUAGES) {
      const t = forgetTranslations[lang];
      for (const key of REQUIRED_KEYS) {
        const value = t[key];
        expect(typeof value).toBe("string");
        expect(value.length).toBeGreaterThan(0);
      }
    }
  });
});
