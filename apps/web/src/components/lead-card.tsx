import type { Conflict, Profile, ScoreLine } from "@inmo/core";
import { ConflictButtons, RefreshLeadButton } from "@/app/(panel)/leads/lead-buttons";
import { FIELD_TITLE, SHOWN_FIELDS, showValue } from "@/lib/lead-format";

/** Ficha del lead: cada dato con la frase del cliente que lo respalda, el puntaje explicado y las contradicciones a decidir. */
export function LeadCard({ contactId, conversationId, profile, conflicts, score, breakdown }: {
  contactId: string; conversationId: string; profile: Profile; conflicts: Conflict[]; score: number; breakdown: ScoreLine[];
}) {
  const fields = SHOWN_FIELDS.filter((f) => profile[f]);
  return (
    <div className="space-y-3 text-sm">
      {fields.length ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {fields.map((f) => (
            <div key={f} className="contents">
              <dt className="text-zinc-500">{FIELD_TITLE[f]}</dt>
              <dd>
                {showValue(f, profile[f]!.value, profile)}
                <span className="ml-2 text-xs italic text-zinc-400">«{profile[f]!.quote}»</span>
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-zinc-500">Todavía no dijo qué busca.</p>
      )}

      {conflicts.length > 0 && (
        <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-2">
          <div className="text-xs font-medium text-amber-900">Dijo cosas distintas: decidí cuál vale</div>
          {conflicts.map((c, i) => (
            <div key={`${c.field}-${i}`} className="space-y-1 text-xs">
              <div>
                <b>{FIELD_TITLE[c.field]}:</b> antes {showValue(c.field, c.current.value, profile)} <i className="text-zinc-500">«{c.current.quote}»</i>
                {" → "}ahora {showValue(c.field, c.proposed.value, profile)} <i className="text-zinc-500">«{c.proposed.quote}»</i>
              </div>
              <ConflictButtons contactId={contactId} conversationId={conversationId} index={i} />
            </div>
          ))}
        </div>
      )}

      <div>
        <div className="text-xs font-medium text-zinc-600">Puntaje {score}</div>
        <ul className="mt-1 flex flex-wrap gap-1 text-xs">
          {breakdown.map((b) => (
            <li key={b.rule_id} className={`rounded px-1.5 py-0.5 ${b.points < 0 ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>
              {b.label} {b.points > 0 ? `+${b.points}` : b.points}
            </li>
          ))}
          {breakdown.length === 0 && <li className="text-zinc-400">Ninguna regla suma todavía</li>}
        </ul>
      </div>
      <RefreshLeadButton conversationId={conversationId} />
    </div>
  );
}
