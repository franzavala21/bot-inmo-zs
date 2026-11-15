import { describe, expect, it } from "vitest";
import { parseTokkoInquiry } from "../tokko/inquiry-email";

// Misma estructura que el email real de Tokko, con datos INVENTADOS (el real tiene datos de clientes y no va al repo).
const EMAIL = `<div><h1>Respondé pronto a Ana Prueba</h1><div><p>Hola Francisco Zavala,</p><p>Hay una nueva consulta de Ana Prueba.</p></div>
<a href="https://www.tokkobroker.com/marketing/webcontact/123456789/"><span>Ver en Tokko</span></a>
<p>Información de contacto</p><p>Cliente</p><p>Ana Prueba</p>
<table><tr><td><p>Correo electrónico</p><p><a href="mailto:ana.prueba@example.com">ana.prueba@example.com</a></p></td>
<td><p>Teléfono</p><p><a href="tel:+54%20351%2015123-4567" value="+5493511234567">+5493511234567</a> / <a href="tel:+5493511234567">+5493511234567</a></p></td></tr></table>
<p>Etiquetas</p><p><span>zonaprop</span><span>Consulta</span><span>Colón</span><span>Venta</span><span>Casa</span></p>
<p>Mensaje</p><p>[Colón | Venta | Casa] <br> &iexcl;Hola! Quiero que se comuniquen conmigo por esta propiedad. <a href="https://www.zonaprop.com.ar/panel/feedback/1">link</a></p>
<p>Propiedades/Emprendimientos relacionados</p>
<table><tr><td><a href="https://ficha.info/p/abc" title="Casa en Colon | Salsipuedes">&nbsp;</a></td>
<td><p><b>ZHO1234567</b>&nbsp;&nbsp;Casa en Colon | Salsipuedes</p><table><tr><td>USD 95.000</td><td>Venta</td></tr></table>
<p>Calle Falsa 123</p><p>120 m² Tot. Const.</p></td></tr></table>
<p>¿Necesitás ayuda? Escribinos a <a href="mailto:contact@tokkobroker.com">contact@tokkobroker.com</a></p></div>`;

describe("email 'Nueva consulta' de Tokko", () => {
  it("saca contacto, etiquetas, mensaje y propiedad", () => {
    const r = parseTokkoInquiry(EMAIL);
    expect(r).toMatchObject({
      name: "Ana Prueba", email: "ana.prueba@example.com", phone: "5493511234567",
      tags: ["zonaprop", "Consulta", "Colón", "Venta", "Casa"], propertyCodes: ["ZHO1234567"],
      propertyTitle: "Casa en Colon | Salsipuedes", webcontactId: 123456789,
    });
    expect(r.message).toContain("¡Hola! Quiero que se comuniquen conmigo");
  });
  it("nunca devuelve la dirección de la propiedad", () => {
    expect(JSON.stringify(parseTokkoInquiry(EMAIL))).not.toContain("Calle Falsa");
  });
  it("sin mensaje (consulta de Mercadolibre)", () => {
    const r = parseTokkoInquiry(EMAIL.replace(/<p>Mensaje<\/p>[\s\S]*?<\/p>/, ""));
    expect(r.message).toBeNull();
    expect(r.propertyCodes).toEqual(["ZHO1234567"]);
  });
});
