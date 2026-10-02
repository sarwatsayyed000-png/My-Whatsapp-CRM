// ============================================================
// First-response pairing — pure, shared by the dashboard's response
// time chart (queries.ts) and the CRM Team Performance leaderboard
// (src/lib/crm/metrics.ts).
// ============================================================

export interface ResponseMessageRow {
  conversation_id: string;
  sender_type: string;
  created_at: string;
}

export interface ResponseSample {
  conversationId: string;
  customerAt: Date;
  responseAt: Date;
}

/**
 * Pair each unanswered customer message with the next outbound reply
 * in the same conversation — the same rule the dashboard's response
 * time chart uses (see loadResponseTime in queries.ts). Rows must be sorted
 * by conversation, then created_at.
 */
export function pairResponseSamples(rows: ResponseMessageRow[]): ResponseSample[] {
  const samples: ResponseSample[] = [];
  let currentConv = "";
  let pending: Date | null = null;
  for (const row of rows) {
    if (row.conversation_id !== currentConv) {
      currentConv = row.conversation_id;
      pending = null;
    }
    const ts = new Date(row.created_at);
    if (row.sender_type === "customer") {
      if (!pending) pending = ts;
    } else if (pending) {
      samples.push({ conversationId: row.conversation_id, customerAt: pending, responseAt: ts });
      pending = null;
    }
  }
  return samples;
}

