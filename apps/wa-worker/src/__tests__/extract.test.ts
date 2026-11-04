import { describe, it, expect } from "vitest";
import type { WAMessage } from "baileys";
import { extract } from "../extract";

const PN = "5493511234567@s.whatsapp.net";
const msg = (over: Partial<WAMessage> & { message?: WAMessage["message"] }): WAMessage =>
  ({ key: { id: "ID1", remoteJid: PN, fromMe: false }, messageTimestamp: 1_760_000_000, pushName: "Ana", ...over }) as WAMessage;

describe("extract", () => {
  it("texto simple de un número", () => {
    const r = extract(msg({ message: { conversation: "Hola, ¿sigue disponible?" } }))!;
    expect(r).toMatchObject({ phone: "5493511234567", waJid: PN, kind: "text", body: "Hola, ¿sigue disponible?", fromMe: false, displayName: "Ana" });
    expect(r.sentAt.toISOString()).toBe(new Date(1_760_000_000_000).toISOString());
  });
  it("texto extendido (con link o respuesta)", () => {
    expect(extract(msg({ message: { extendedTextMessage: { text: "mirá esto" } } }))?.body).toBe("mirá esto");
  });
  it("audio: marca que hay archivo y no lleva texto", () => {
    expect(extract(msg({ message: { audioMessage: { ptt: true } } }))).toMatchObject({ kind: "audio", body: null, hasMedia: true });
  });
  it("imagen con epígrafe dentro de un mensaje temporal", () => {
    const r = extract(msg({ message: { ephemeralMessage: { message: { imageMessage: { caption: "esta casa" } } } } }));
    expect(r).toMatchObject({ kind: "image", body: "esta casa", hasMedia: true });
  });
  it("ignora grupos, estados y canales", () => {
    for (const jid of ["123-456@g.us", "status@broadcast", "123@newsletter"])
      expect(extract(msg({ key: { id: "X", remoteJid: jid }, message: { conversation: "hola" } }))).toBeNull();
  });
  it("ignora reacciones y mensajes de sistema", () => {
    expect(extract(msg({ message: { reactionMessage: { text: "👍" } } }))).toBeNull();
    expect(extract(msg({ message: { protocolMessage: { type: 0 } } }))).toBeNull();
    expect(extract(msg({ message: null }))).toBeNull();
  });
  it("LID con número alternativo: usa el número", () => {
    const r = extract(msg({ key: { id: "X", remoteJid: "99887766@lid", remoteJidAlt: PN }, message: { conversation: "hola" } }));
    expect(r).toMatchObject({ phone: "5493511234567", waJid: PN });
  });
  it("LID sin número: lo identifica y le responde por LID", () => {
    const r = extract(msg({ key: { id: "X", remoteJid: "99887766@lid" }, message: { conversation: "hola" } }));
    expect(r).toMatchObject({ phone: "lid:99887766", waJid: "99887766@lid" });
  });
  it("mensaje propio (escrito desde el teléfono): sin nombre y from_me", () => {
    const r = extract(msg({ key: { id: "X", remoteJid: PN, fromMe: true }, message: { conversation: "te llamo" } }));
    expect(r).toMatchObject({ fromMe: true, displayName: null });
  });
  it("quita el sufijo de dispositivo del JID", () => {
    expect(extract(msg({ key: { id: "X", remoteJid: "5493511234567:12@s.whatsapp.net" }, message: { conversation: "a" } }))?.waJid).toBe(PN);
  });
  it("tipo desconocido no se pierde: queda como 'other'", () => {
    expect(extract(msg({ message: { pollCreationMessage: { name: "¿?" } } }))?.kind).toBe("other");
  });
});
