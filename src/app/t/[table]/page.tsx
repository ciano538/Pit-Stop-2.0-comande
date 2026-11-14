import OrderApp from '@/components/OrderApp';
import { TABLES } from '@/lib/menu';
import { checkTableCode } from '@/lib/server';

export const dynamic = 'force-dynamic';

/** Pagina del cliente: si arriva dal QR del tavolo (/t/7?k=codice) */
export default function CustomerPage({
  params,
  searchParams,
}: {
  params: { table: string };
  searchParams: { k?: string };
}) {
  const n = Number(params.table);
  if (!Number.isInteger(n) || n < 1 || n > TABLES || !checkTableCode(n, searchParams.k)) {
    return (
      <div className="pin">
        <span className="logo">PIT STOP 2.0</span>
        <h1>QR</h1>
        <p style={{ textAlign: 'center', maxWidth: 320, lineHeight: 1.5 }}>
          Codice non valido: inquadra di nuovo il QR sul tavolo o chiedi al personale.
          <br />
          Invalid code: please scan the QR on your table again or ask our staff.
          <br />
          Ungültiger Code: bitte den QR-Code am Tisch erneut scannen oder das Personal fragen.
        </p>
      </div>
    );
  }
  return <OrderApp fixedTable={n} code={searchParams.k!} />;
}
