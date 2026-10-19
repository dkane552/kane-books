/**
 * Minimal .xlsx writer (no dependencies). Supports text, numbers, dates, formulas, bold/italic,
 * font and fill colors, number formats, borders, column widths, frozen header rows and
 * fit-to-width printing. Formulas are written without cached values and Excel recalculates
 * them on open (fullCalcOnLoad).
 */

export type Fmt = "money" | "pct" | "date" | "int";
export interface CellStyle {
  bold?: boolean;
  italic?: boolean;
  size?: number;
  color?: string; // RRGGBB
  fill?: string; // RRGGBB
  fmt?: Fmt;
  border?: "sub" | "total";
  align?: "left" | "center" | "right";
  wrap?: boolean;
}
export type CellValue =
  string | number | boolean | null | undefined | { date: string } | { f: string };

interface Cell {
  v: CellValue;
  s: number;
}

const FMT_CODES: Record<Fmt, { id: number; code: string }> = {
  money: { id: 164, code: '#,##0.00;(#,##0.00);"-"' },
  pct: { id: 165, code: '0.0%;(0.0%);"-"' },
  date: { id: 166, code: "mm/dd/yyyy" },
  int: { id: 1, code: "0" },
};

export function colLetter(n: number): string {
  let s = "";
  let x = n;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // characters XML 1.0 does not allow
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

function excelSerial(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return (Date.UTC(y!, m! - 1, d!) - Date.UTC(1899, 11, 30)) / 86400000;
}

class StyleBook {
  fonts: string[] = ['<font><sz val="10"/><name val="Arial"/></font>'];
  fills: string[] = [
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>',
  ];
  borders: string[] = ["<border><left/><right/><top/><bottom/><diagonal/></border>"];
  xfs: string[] = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  private keys = new Map<string, number>([["{}", 0]]);

  id(style: CellStyle = {}): number {
    const key = JSON.stringify(style);
    const hit = this.keys.get(key);
    if (hit !== undefined) return hit;
    const font = `<font>${style.bold ? "<b/>" : ""}${style.italic ? "<i/>" : ""}<sz val="${style.size ?? 10}"/>${
      style.color ? `<color rgb="FF${style.color}"/>` : ""
    }<name val="Arial"/></font>`;
    const fontId = this.push(this.fonts, font);
    const fillId = style.fill
      ? this.push(
          this.fills,
          `<fill><patternFill patternType="solid"><fgColor rgb="FF${style.fill}"/><bgColor indexed="64"/></patternFill></fill>`,
        )
      : 0;
    const borderId =
      style.border === "sub"
        ? this.push(
            this.borders,
            '<border><left/><right/><top style="thin"><color auto="1"/></top><bottom/><diagonal/></border>',
          )
        : style.border === "total"
          ? this.push(
              this.borders,
              '<border><left/><right/><top style="thin"><color auto="1"/></top><bottom style="double"><color auto="1"/></bottom><diagonal/></border>',
            )
          : 0;
    const numFmtId = style.fmt ? FMT_CODES[style.fmt].id : 0;
    const align =
      style.align || style.wrap
        ? `<alignment${style.align ? ` horizontal="${style.align}"` : ""}${style.wrap ? ' wrapText="1" vertical="top"' : ""}/>`
        : "";
    const xf = `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"${
      numFmtId ? ' applyNumberFormat="1"' : ""
    }${fontId ? ' applyFont="1"' : ""}${fillId ? ' applyFill="1"' : ""}${borderId ? ' applyBorder="1"' : ""}${
      align ? ' applyAlignment="1">' + align + "</xf>" : "/>"
    }`;
    const id = this.xfs.push(xf) - 1;
    this.keys.set(key, id);
    return id;
  }
  private push(list: string[], item: string) {
    const i = list.indexOf(item);
    return i >= 0 ? i : list.push(item) - 1;
  }
  xml(): string {
    const fmts = Object.values(FMT_CODES).filter((f) => f.id >= 164);
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      `<numFmts count="${fmts.length}">${fmts.map((f) => `<numFmt numFmtId="${f.id}" formatCode="${esc(f.code)}"/>`).join("")}</numFmts>` +
      `<fonts count="${this.fonts.length}">${this.fonts.join("")}</fonts>` +
      `<fills count="${this.fills.length}">${this.fills.join("")}</fills>` +
      `<borders count="${this.borders.length}">${this.borders.join("")}</borders>` +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      `<cellXfs count="${this.xfs.length}">${this.xfs.join("")}</cellXfs>` +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      "</styleSheet>"
    );
  }
}

export class Sheet {
  rows = new Map<number, Map<number, Cell>>();
  widths: number[] = [];
  freezeRows = 0;
  constructor(
    public name: string,
    private styles: StyleBook,
  ) {}

  /** Row and column are 1-based. */
  set(row: number, col: number, v: CellValue, style?: CellStyle) {
    let r = this.rows.get(row);
    if (!r) this.rows.set(row, (r = new Map()));
    r.set(col, { v, s: this.styles.id(style) });
    return this;
  }
  xml(): string {
    const rowNums = [...this.rows.keys()].sort((a, b) => a - b);
    const lastRow = rowNums.at(-1) ?? 1;
    const lastCol = Math.max(1, ...[...this.rows.values()].flatMap((r) => [...r.keys()]));
    const data = rowNums
      .map((rn) => {
        const cells = [...this.rows.get(rn)!.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([cn, c]) => cellXml(`${colLetter(cn)}${rn}`, c))
          .join("");
        return `<row r="${rn}">${cells}</row>`;
      })
      .join("");
    const pane = this.freezeRows
      ? `<pane ySplit="${this.freezeRows}" topLeftCell="A${this.freezeRows + 1}" activePane="bottomLeft" state="frozen"/>`
      : "";
    const cols = this.widths.length
      ? `<cols>${this.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`
      : "";
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' +
      `<dimension ref="A1:${colLetter(lastCol)}${lastRow}"/>` +
      `<sheetViews><sheetView showGridLines="0" workbookViewId="0">${pane}</sheetView></sheetViews>` +
      '<sheetFormatPr defaultRowHeight="13"/>' +
      cols +
      `<sheetData>${data}</sheetData>` +
      '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>' +
      '<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>' +
      "</worksheet>"
    );
  }
}

function cellXml(ref: string, c: Cell): string {
  const s = c.s ? ` s="${c.s}"` : "";
  const v = c.v;
  if (v === null || v === undefined || v === "") return c.s ? `<c r="${ref}"${s}/>` : "";
  if (typeof v === "number") return Number.isFinite(v) ? `<c r="${ref}"${s}><v>${v}</v></c>` : "";
  if (typeof v === "boolean") return `<c r="${ref}"${s} t="b"><v>${v ? 1 : 0}</v></c>`;
  if (typeof v === "string")
    return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  if ("date" in v) return `<c r="${ref}"${s}><v>${excelSerial(v.date)}</v></c>`;
  return `<c r="${ref}"${s}><f>${esc(v.f.replace(/^=/, ""))}</f></c>`;
}

export class Workbook {
  private styles = new StyleBook();
  sheets: Sheet[] = [];
  addSheet(name: string): Sheet {
    const sh = new Sheet(name.slice(0, 31), this.styles);
    this.sheets.push(sh);
    return sh;
  }
  /** The workbook as .xlsx bytes. */
  bytes(): Uint8Array {
    const n = this.sheets.length;
    const files: [string, string][] = [
      [
        "[Content_Types].xml",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          this.sheets
            .map(
              (_, i) =>
                `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
            )
            .join("") +
          "</Types>",
      ],
      [
        "_rels/.rels",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          "</Relationships>",
      ],
      [
        "xl/workbook.xml",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          `<sheets>${this.sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>` +
          '<calcPr calcId="191029" fullCalcOnLoad="1"/>' +
          "</workbook>",
      ],
      [
        "xl/_rels/workbook.xml.rels",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          this.sheets
            .map(
              (_, i) =>
                `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
            )
            .join("") +
          `<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
          "</Relationships>",
      ],
      ...this.sheets.map((s, i): [string, string] => [`xl/worksheets/sheet${i + 1}.xml`, s.xml()]),
      ["xl/styles.xml", this.styles.xml()],
    ];
    return zipStore(files.map(([name, text]) => [name, new TextEncoder().encode(text)]));
  }
}

// ---------- zip (stored, no compression) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipStore(entries: [string, Uint8Array][]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBytes = enc.encode(name);
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 0, true); // stored
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    parts.push(local, data);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    central.push(cd);
    offset += local.length + data.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let p = 0;
  for (const a of all) {
    out.set(a, p);
    p += a.length;
  }
  return out;
}
