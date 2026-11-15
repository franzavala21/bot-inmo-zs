/**
 * Manda al CRM los emails "Nueva consulta" de Tokko (traen la propiedad consultada, que la API de Tokko no da).
 * Corre en TU cuenta de Gmail, cada 5 minutos. No borra ni modifica emails: solo les pone la etiqueta "crm-procesado".
 *
 * Instalación (una sola vez):
 *  1. Entrá a https://script.google.com con la cuenta donde te llegan los avisos de Tokko → "Nuevo proyecto".
 *  2. Borrá lo que haya y pegá TODO este archivo. Guardá (ícono de disquete).
 *  3. Engranaje "Configuración del proyecto" → "Propiedades de la secuencia de comandos" → "Agregar propiedad":
 *       nombre: EMAIL_INGEST_SECRET    valor: (pegá la clave que te pasaron; no la compartas)
 *  4. Arriba, elegí la función "instalar" y tocá "Ejecutar". Google te pide permisos: aceptalos (es tu propio script).
 *  5. Listo: corre solo cada 5 minutos. Para probar ya, ejecutá "enviarConsultas".
 */
const URL_CRM = 'https://bot-inmo-zs-vl7l.vercel.app/api/email/tokko';
const BUSQUEDA = 'subject:"Nueva consulta" "Tokko Broker" -label:crm-procesado newer_than:30d';
const ETIQUETA = 'crm-procesado';
const LOTE = 20;

function enviarConsultas() {
  const secreto = PropertiesService.getScriptProperties().getProperty('EMAIL_INGEST_SECRET');
  if (!secreto) throw new Error('Falta la propiedad EMAIL_INGEST_SECRET (paso 3 de la instalación)');
  const etiqueta = GmailApp.getUserLabelByName(ETIQUETA) || GmailApp.createLabel(ETIQUETA);
  const hilos = GmailApp.search(BUSQUEDA, 0, 30);
  for (const hilo of hilos) {
    const mensajes = hilo.getMessages()
      .filter(function (m) { return m.getSubject().indexOf('Nueva consulta') !== -1; })
      .map(function (m) { return { id: m.getId(), date: m.getDate().toISOString(), html: m.getBody() }; });
    for (let i = 0; i < mensajes.length; i += LOTE) {
      const r = UrlFetchApp.fetch(URL_CRM, {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { Authorization: 'Bearer ' + secreto },
        payload: JSON.stringify({ messages: mensajes.slice(i, i + LOTE) }),
      });
      if (r.getResponseCode() !== 200) throw new Error('El CRM respondió ' + r.getResponseCode() + ': se reintenta en 5 minutos');
    }
    hilo.addLabel(etiqueta); // solo si el CRM lo recibió bien
  }
}

function instalar() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'enviarConsultas') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('enviarConsultas').timeBased().everyMinutes(5).create();
  enviarConsultas();
}
