export interface FetchRowsResult<Row> {
  data: Row[] | null;
  error: { message: string } | null;
}

export async function fetchAllRows<Row>(
  makeQuery: (from: number, to: number) => PromiseLike<FetchRowsResult<Row>>,
): Promise<{ data: Row[]; error: { message: string } | null }> {
  const pageSize = 1000;
  const rows: Row[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await makeQuery(from, from + pageSize - 1);
    if (error) return { data: rows, error };

    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  return { data: rows, error: null };
}
