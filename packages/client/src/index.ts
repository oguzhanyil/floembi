/**
 * Floem istemci sözleşmesi.
 *
 * Arayüz bileşenleri (model görünümü, rapor, görseller) yalnızca bu tiplerle
 * konuşur. Desktop'ta yerel servise, web'de floembi.app sunucusuna bağlanan
 * iki ayrı implementasyon olacak; böylece web'de düzenleme ileride eklenebilir.
 */

export interface ApiErrorBody {
  code: string;
  message: string;
  detail?: string;
}

export class FloemApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly detail?: string,
  ) {
    super(message);
  }
}

export type AuthKind = "sql" | "windows";

export interface ConnectionInput {
  kind: "sqlserver";
  server: string;
  database?: string | null;
  auth: AuthKind;
  user?: string | null;
  password?: string | null;
  trust_server_certificate: boolean;
  remember_password: boolean;
}

export interface Connection {
  id: string;
  kind: "sqlserver";
  server: string;
  database: string | null;
  auth: AuthKind;
  user: string | null;
  trust_server_certificate: boolean;
}

export interface ServerInfo {
  version: string;
  edition: string;
  database: string;
  login: string;
}

export interface ConnectResult extends Connection {
  server_info: ServerInfo;
  databases: string[];
}

export interface DbObject {
  schema: string;
  name: string;
  type: "TABLE" | "VIEW";
  row_count: number | null;
}

export interface ColumnInfo {
  name: string;
  data_type: string;
  nullable: boolean;
  is_primary_key: boolean;
}

export interface ResultColumn {
  name: string;
  type: string;
}

export interface QueryResult {
  columns: ResultColumn[];
  rows: unknown[][];
  truncated: boolean;
  elapsed_ms: number;
  row_count: number;
}

/** Desktop'a özgü kaynak işlemleri (web'de gateway üzerinden ayrı bir arayüz olacak). */
export interface SourceClient {
  listConnections(): Promise<Connection[]>;
  connect(input: ConnectionInput): Promise<ConnectResult>;
  removeConnection(id: string): Promise<void>;
  databases(connectionId: string): Promise<string[]>;
  objects(connectionId: string, database: string): Promise<DbObject[]>;
  columns(connectionId: string, database: string, schema: string, table: string): Promise<ColumnInfo[]>;
  preview(connectionId: string, database: string, schema: string, table: string, limit?: number): Promise<QueryResult>;
  runSql(connectionId: string, database: string | null, sql: string, limit?: number): Promise<QueryResult>;
}

export interface HttpConfig {
  baseUrl: string;
  headers: Record<string, string>;
  /** Ağ hatasında (sunucu kapalı, bağlantı yok) gösterilecek açıklama */
  unreachableMessage?: string;
}

export class HttpClient {
  constructor(private readonly config: HttpConfig) {}

  async request<T>(method: string, path: string, body?: unknown, params?: Record<string, string>): Promise<T> {
    const url = new URL(path, this.config.baseUrl);
    if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: { ...this.config.headers, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new FloemApiError(0, "service_unreachable", this.config.unreachableMessage ?? "Sunucuya ulaşılamadı", String(e));
    }
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const err: ApiErrorBody | undefined = data?.error;
      if (err) throw new FloemApiError(res.status, err.code, err.message, err.detail);
      const detail = typeof data?.detail === "string" ? data.detail : JSON.stringify(data?.detail ?? data);
      throw new FloemApiError(res.status, `http_${res.status}`, res.status === 401 ? "Oturum geçersiz" : "İstek başarısız", detail);
    }
    return data as T;
  }
}

const DESKTOP_UNREACHABLE =
  "Floem BI arka plan servisine ulaşılamadı. Floem BI'ı kapatıp yeniden açın; sorun sürerse 'npm run desktop' terminalini kontrol edin.";

/** Desktop yerel servisine bağlanan implementasyon. */
export class DesktopSourceClient implements SourceClient {
  private http: HttpClient;

  constructor(baseUrl: string, token: string) {
    this.http = new HttpClient({ baseUrl, headers: { "X-Floem-Token": token }, unreachableMessage: DESKTOP_UNREACHABLE });
  }

  listConnections() {
    return this.http.request<Connection[]>("GET", "/connections");
  }
  connect(input: ConnectionInput) {
    return this.http.request<ConnectResult>("POST", "/connections", input);
  }
  async removeConnection(id: string) {
    await this.http.request("DELETE", `/connections/${encodeURIComponent(id)}`);
  }
  databases(id: string) {
    return this.http.request<string[]>("GET", `/connections/${encodeURIComponent(id)}/databases`);
  }
  objects(id: string, database: string) {
    return this.http.request<DbObject[]>("GET", `/connections/${encodeURIComponent(id)}/objects`, undefined, { database });
  }
  columns(id: string, database: string, schema: string, table: string) {
    return this.http.request<ColumnInfo[]>("GET", `/connections/${encodeURIComponent(id)}/columns`, undefined, { database, schema, table });
  }
  preview(id: string, database: string, schema: string, table: string, limit = 200) {
    return this.http.request<QueryResult>("GET", `/connections/${encodeURIComponent(id)}/preview`, undefined, {
      database, schema, table, limit: String(limit),
    });
  }
  runSql(id: string, database: string | null, sql: string, limit = 1000) {
    return this.http.request<QueryResult>("POST", `/connections/${encodeURIComponent(id)}/sql`, { database, sql, limit });
  }
}

// ------------------------------------------------------------------ semantik model
export type ColumnType = "int32" | "int64" | "decimal" | "double" | "string" | "date" | "datetime" | "bool";
export type Summarize = "sum" | "avg" | "min" | "max" | "count" | "none";

export interface ModelColumn {
  ad: string;
  kaynak?: string;
  ifade?: string;
  tip: ColumnType;
  gizli: boolean;
  anahtar: boolean;
  ozet?: Summarize;
  bicim?: string;
  siralama_sutunu?: string;
  veri_kategorisi?: string;
}

export interface ModelMeasure {
  ad: string;
  ifade: string;
  bicim?: string;
  klasor?: string;
  aciklama?: string;
}

export interface TableQuery {
  kaynak: string;
  veritabani?: string;
  sema?: string;
  tablo?: string;
  sql?: string;
  /** Power Query "Uygulanan adımlar" karşılığı */
  adimlar?: TransformStep[];
}

// ---- Veri dönüştürme (Power Query) adımları; floem_bi.transform.steps ile aynı şema
export type StepType = "int64" | "decimal" | "double" | "string" | "date" | "datetime" | "bool";
export type FilterOp =
  | "esit" | "esit_degil" | "buyuk" | "buyuk_esit" | "kucuk" | "kucuk_esit" | "icinde" | "icinde_degil"
  | "icerir" | "icermez" | "ile_baslar" | "ile_biter" | "bos" | "bos_degil" | "arasinda";
export type Scalar = string | number | boolean | null;
export type AggOp = "toplam" | "ortalama" | "en_kucuk" | "en_buyuk" | "say" | "farkli_say";

export type TransformStep =
  | { tur: "yeniden_adlandir"; sutun: string; yeni_ad: string }
  | { tur: "sutun_kaldir"; sutunlar: string[] }
  | { tur: "sutun_sec"; sutunlar: string[] }
  | { tur: "tip_degistir"; sutun: string; tip: StepType }
  | { tur: "satir_filtrele"; sutun: string; islem: FilterOp; degerler: Scalar[] }
  | { tur: "deger_degistir"; sutun: string; bul: Scalar; yerine: Scalar }
  | { tur: "metin"; sutun: string; islem: "kirp" | "buyuk" | "kucuk" }
  | { tur: "sutun_bol"; sutun: string; ayirici: string; adet: number }
  | { tur: "sutun_birlestir"; sutunlar: string[]; ayirici: string; yeni_ad: string }
  | { tur: "ozel_sutun"; ad: string; ifade: string }
  | { tur: "yinelenenleri_kaldir"; sutunlar: string[] }
  | { tur: "grupla"; gruplar: string[]; toplamalar: { sutun: string | null; islem: AggOp; ad: string }[] }
  | { tur: "ters_ozet"; sutunlar: string[]; nitelik_adi: string; deger_adi: string }
  | {
      tur: "sorgu_birlestir"; tablo: string; sol: string[]; sag: string[]; birlesim: "sol" | "ic";
      sutunlar: string[]; onek: string;
    }
  | { tur: "sorgu_ekle"; tablolar: string[] };

export interface TransformPreview {
  columns: ResultColumn[];
  rows: unknown[][];
  truncated: boolean;
  /** önizlemede uygulanan adım sayısı (hata varsa hatalı adımın sırası) */
  applied: number;
  error: { step: number; message: string; detail: string } | null;
}

export interface ModelTable {
  ad: string;
  kaynak: { katman: string; tablo: string };
  sorgu?: TableQuery;
  mod: "import" | "directquery" | "dual";
  gizli: boolean;
  aciklama?: string;
  sutunlar: ModelColumn[];
  olculer: ModelMeasure[];
  hiyerarsiler: { ad: string; seviyeler: string[] }[];
  tarih_tablosu?: { anahtar_sutun: string };
}

export interface Relationship {
  kimden: string; // çok tarafı: Tablo[Sütun]
  kime: string; // bir tarafı
  kardinalite: "*:1" | "1:1";
  filtre_yonu: "tek" | "cift";
  aktif: boolean;
  referans_butunlugu: boolean;
}

export interface DataSource {
  id: string;
  tur: "sqlserver";
  sunucu: string;
  veritabani?: string;
  kimlik: AuthKind;
  kullanici?: string;
}

export interface ModelDefinition {
  model: { ad: string; surum: number; kultur: string };
  veri_kaynaklari: DataSource[];
  tablolar: ModelTable[];
  iliskiler: Relationship[];
  roller: unknown[];
}

export interface DiagramPosition {
  x: number;
  y: number;
  collapsed?: boolean;
}

// ------------------------------------------------------------------ rapor
export type VisualType =
  | "table"
  | "card" | "multicard" | "kpi"
  | "column" | "bar" | "stackedcolumn" | "stackedbar" | "line" | "area"
  | "pie" | "donut"
  | "matrix"
  | "scatter" | "treemap" | "heatmap" | "waterfall" | "gauge" | "progress"
  | "slicer";
export type Agg = "sum" | "avg" | "min" | "max" | "count" | "distinctcount";

export interface FieldRef {
  table: string;
  column: string;
}

/** Değer alanı: modeldeki ölçü ya da sütunun örtük toplaması */
export type ValueRef = { measure: string } | { table: string; column: string; agg: Agg };

export interface FilterRef {
  table: string;
  column: string;
  op?: "in" | "not_in" | "eq" | "ne" | "lt" | "le" | "gt" | "ge" | "between";
  values: (string | number | boolean | null)[];
}

export interface Visual {
  id: string;
  type: VisualType;
  x: number;
  y: number;
  w: number;
  h: number;
  title?: string;
  group: FieldRef[];
  /** Grafik: Gösterge (seriyi böler) */
  legend?: FieldRef[];
  values: ValueRef[];
  /** KPI: Hedef */
  target?: ValueRef[];
  filters: FilterRef[];
  format: VisualFormat;
  /** Etkileşim durumu: dilimleyici seçimi, tablo sıralaması */
  state?: VisualState;
}

export interface VisualFormat {
  showTitle?: boolean;
  dataLabels?: boolean;
  legend?: "top" | "bottom" | "right" | "none";
  xAxisTitle?: boolean;
  yAxisTitle?: boolean;
  colors?: string[];
  /** Dilimleyici görünümü */
  slicerStyle?: "list" | "dropdown" | "range";
  /** Satır renklendirme, yazı boyutu vb. */
  [k: string]: unknown;
}

export interface VisualState {
  /** Dilimleyici: seçili değerler (liste/açılır) ya da [başlangıç, bitiş] (aralık) */
  selected?: (string | number | boolean | null)[];
  range?: [string | number | null, string | number | null];
  /** Tablo: sıralama (sonuç sütun sırası) */
  sort?: { index: number; desc: boolean };
  /** Drill-down: hangi eksen düzeyinde, hangi üst değerlerin içindeyiz */
  drill?: { level: number; path: (string | number | boolean | null)[] };
  /** Matris: açık satır düğümleri (yol anahtarları) */
  expanded?: string[];
  [k: string]: unknown;
}

export interface ReportPage {
  id: string;
  name: string;
  width: number;
  height: number;
  visuals: Visual[];
}

export interface ReportDefinition {
  version: number;
  pages: ReportPage[];
}

export interface VisualQuery {
  group: FieldRef[];
  values: ValueRef[];
  filters?: FilterRef[];
  order_by?: { index: number; desc?: boolean }[];
  limit?: number;
  totals?: boolean;
}

export interface VisualResultColumn {
  name: string;
  kind: "group" | "value";
  type: ColumnType;
  format?: string | null;
  ref?: string;
}

export interface VisualResult {
  columns: VisualResultColumn[];
  rows: (string | number | boolean | null)[][];
  truncated: boolean;
  total: (number | null)[] | null;
}

export interface DocumentState {
  id: string;
  name: string;
  path: string | null;
  dirty: boolean;
  revision: number;
  model: ModelDefinition;
  diagram: { version?: number; tables: Record<string, DiagramPosition> };
  report: ReportDefinition;
  stats: Record<string, { rows: number | null }>;
  warnings: string[];
  /** Açılışta komut satırından verilen dosya açılamadıysa (bir kez gelir) */
  startup_error?: ApiErrorBody;
}

/** Model düzenleme işlemleri (servisteki document/ops.py ile birebir). */
export type ModelOp =
  | { op: "rename_table"; table: string; new_name: string }
  | { op: "update_table"; table: string; gizli?: boolean; aciklama?: string | null }
  | { op: "delete_table"; table: string }
  | { op: "rename_column"; table: string; column: string; new_name: string }
  | {
      op: "update_column";
      table: string;
      column: string;
      gizli?: boolean;
      tip?: ColumnType;
      bicim?: string | null;
      ozet?: Summarize | null;
      siralama_sutunu?: string | null;
      veri_kategorisi?: string | null;
    }
  | ({ op: "add_relationship"; kimden: string; kime: string } & Partial<Omit<Relationship, "kimden" | "kime">>)
  | ({
      op: "update_relationship";
      kimden: string;
      kime: string;
      yeni_kimden?: string;
      yeni_kime?: string;
    } & Partial<Omit<Relationship, "kimden" | "kime">>)
  | { op: "delete_relationship"; kimden: string; kime: string }
  | { op: "mark_date_table"; table: string; column: string | null }
  | { op: "add_measure"; table: string; name: string; expression: string; bicim?: string | null; klasor?: string | null; aciklama?: string | null }
  | {
      op: "update_measure";
      name: string;
      new_name?: string;
      expression?: string;
      table?: string;
      bicim?: string | null;
      klasor?: string | null;
      aciklama?: string | null;
    }
  | { op: "delete_measure"; name: string }
  | { op: "create_date_table"; name?: string; start?: string | null; end?: string | null; relate?: string[] };

export interface DaxDiagnostic {
  message: string;
  start: number | null;
  end: number | null;
}

export interface ColumnProfile {
  rows: number;
  distinct: number;
  nulls: number;
  unique: boolean;
}

export interface RelationshipProfile {
  from: ColumnProfile;
  to: ColumnProfile;
  matched: number | null;
  suggested: "*:1" | "1:1" | "1:*" | "*:*";
}

// ------------------------------------------------------------------ işler
export type ImportItem =
  | { database?: string; schema: string; table: string; name?: string }
  | { database?: string; sql: string; name?: string };

export interface JobTable {
  name: string;
  label: string;
  status: "pending" | "running" | "done" | "failed" | "cancelled";
  rows: number;
  error: ApiErrorBody | null;
}

export interface Job {
  id: string;
  kind: "import" | "refresh";
  status: "running" | "succeeded" | "failed" | "cancelled";
  elapsed_ms: number;
  tables: JobTable[];
  error: ApiErrorBody | null;
  result: {
    tables?: string[];
    relationships?: { kimden: string; kime: string; aktif: boolean; neden: string }[];
    warnings?: string[];
  };
}

/** Açık belge (rapor) işlemleri. Web'de düzenleme geldiğinde sunucu da bu arayüzü sağlayacak. */
export interface DocumentClient {
  getDocument(): Promise<DocumentState>;
  newDocument(): Promise<DocumentState>;
  openDocument(path: string): Promise<DocumentState>;
  saveDocument(path?: string): Promise<DocumentState>;
  applyOps(ops: ModelOp[]): Promise<DocumentState>;
  /** auto=true: otomatik yerleşim, belgeyi "değişti" saymaz */
  setDiagram(tables: Record<string, DiagramPosition>, auto?: boolean): Promise<{ ok: boolean; dirty: boolean }>;
  tablePreview(table: string, limit?: number): Promise<QueryResult>;
  setReport(report: ReportDefinition): Promise<{ ok: boolean; dirty: boolean }>;
  query(q: VisualQuery): Promise<VisualResult>;
  relationshipProfile(kimden: string, kime: string): Promise<RelationshipProfile>;
  validateDax(expression: string): Promise<{ ok: boolean; errors: DaxDiagnostic[] }>;
  transformPreview(table: string, steps: TransformStep[], upto?: number | null, limit?: number): Promise<TransformPreview>;
  applySteps(table: string, steps: TransformStep[]): Promise<{ warnings: string[]; document: DocumentState }>;
  startImport(connectionId: string, database: string | null, items: ImportItem[]): Promise<Job>;
  startRefresh(tables?: string[]): Promise<Job>;
  job(id: string): Promise<Job>;
  cancelJob(id: string): Promise<Job>;
}

export interface PublishSession {
  server_url: string;
  email: string;
  logged_in: boolean;
  user: { id: number; email: string; name: string } | null;
}

export interface PublishResult {
  dataset_id: number;
  report_id: number;
  name: string;
  version: number;
  report_version: number;
  replaced: boolean;
  url: string;
}

/** Desktop yerel servisinin tamamı: kaynak + belge işlemleri. */
export class DesktopClient extends DesktopSourceClient implements DocumentClient {
  private doc: HttpClient;

  constructor(baseUrl: string, token: string) {
    super(baseUrl, token);
    this.doc = new HttpClient({ baseUrl, headers: { "X-Floem-Token": token }, unreachableMessage: DESKTOP_UNREACHABLE });
  }

  getDocument() {
    return this.doc.request<DocumentState>("GET", "/document");
  }
  newDocument() {
    return this.doc.request<DocumentState>("POST", "/document/new", {});
  }
  openDocument(path: string) {
    return this.doc.request<DocumentState>("POST", "/document/open", { path });
  }
  saveDocument(path?: string) {
    return this.doc.request<DocumentState>("POST", "/document/save", { path: path ?? null });
  }
  applyOps(ops: ModelOp[]) {
    return this.doc.request<DocumentState>("POST", "/document/ops", { ops });
  }
  setDiagram(tables: Record<string, DiagramPosition>, auto = false) {
    return this.doc.request<{ ok: boolean; dirty: boolean }>("PUT", "/document/diagram", { tables, auto });
  }
  tablePreview(table: string, limit = 100) {
    return this.doc.request<QueryResult>("GET", `/document/tables/${encodeURIComponent(table)}/preview`, undefined, {
      limit: String(limit),
    });
  }
  setReport(report: ReportDefinition) {
    return this.doc.request<{ ok: boolean; dirty: boolean }>("PUT", "/document/report", report);
  }
  query(q: VisualQuery) {
    return this.doc.request<VisualResult>("POST", "/document/query", q);
  }
  validateDax(expression: string) {
    return this.doc.request<{ ok: boolean; errors: DaxDiagnostic[] }>("POST", "/document/dax/validate", { expression });
  }
  transformPreview(table: string, steps: TransformStep[], upto: number | null = null, limit = 1000) {
    return this.doc.request<TransformPreview>("POST", "/document/transform/preview", { table, adimlar: steps, upto, limit });
  }
  applySteps(table: string, steps: TransformStep[]) {
    return this.doc.request<{ warnings: string[]; document: DocumentState }>("POST", "/document/transform/apply", {
      table, adimlar: steps,
    });
  }
  relationshipProfile(kimden: string, kime: string) {
    return this.doc.request<RelationshipProfile>("POST", "/document/relationship-profile", { kimden, kime });
  }
  startImport(connectionId: string, database: string | null, items: ImportItem[]) {
    return this.doc.request<Job>("POST", "/document/import", { connection_id: connectionId, database, items });
  }
  startRefresh(tables?: string[]) {
    return this.doc.request<Job>("POST", "/document/refresh", { tables: tables ?? null });
  }
  job(id: string) {
    return this.doc.request<Job>("GET", `/jobs/${encodeURIComponent(id)}`);
  }
  cancelJob(id: string) {
    return this.doc.request<Job>("POST", `/jobs/${encodeURIComponent(id)}/cancel`);
  }

  // ---- floembi.app'e yayımlama (yükleme yerel servis üzerinden yapılır)
  publishSession() {
    return this.doc.request<PublishSession>("GET", "/publish/session");
  }
  publishLogin(serverUrl: string, email: string, password: string) {
    return this.doc.request<PublishSession & { workspaces: WorkspaceInfo[] }>("POST", "/publish/login", {
      server_url: serverUrl, email, password,
    });
  }
  publishLogout() {
    return this.doc.request<PublishSession>("POST", "/publish/logout");
  }
  publishWorkspaces() {
    return this.doc.request<WorkspaceInfo[]>("GET", "/publish/workspaces");
  }
  publish(workspaceId: number) {
    return this.doc.request<PublishResult>("POST", "/publish", { workspace_id: workspaceId });
  }
}

// ------------------------------------------------------------------ yardımcılar
/** "Tablo[Sütun]" → ["Tablo", "Sütun"] */
export function parseRef(ref: string): [string, string] {
  const m = /^\s*'?([^'[]+?)'?\s*\[([^\]]+)\]\s*$/.exec(ref);
  if (!m) throw new Error(`Geçersiz sütun referansı: ${ref}`);
  return [m[1].trim(), m[2].trim()];
}

export function colRef(table: string, column: string): string {
  return `${table}[${column}]`;
}

// ------------------------------------------------------------------ floembi.app (web)
export interface WebUser {
  id: number;
  email: string;
  name: string;
}

export interface WorkspaceInfo {
  id: number;
  name: string;
  role: "admin" | "member" | "contributor" | "viewer";
  role_label: string;
}

export interface PublishedItem {
  id: number;
  name: string;
  version: number;
  published_at: string;
  published_by: string;
}

export interface WorkspaceContent {
  workspace: WorkspaceInfo;
  datasets: (PublishedItem & { size_bytes: number })[];
  reports: (PublishedItem & { dataset_id: number })[];
}

export interface SharedReport {
  id: number;
  name: string;
  workspace: string;
  published_at: string;
  shared_by: string;
}

export interface PublishedReport {
  id: number;
  name: string;
  version: number;
  published_at: string;
  published_by: string;
  role: string;
  role_label: string;
  workspace: { id: number; name: string };
  dataset: { id: number; name: string; version: number };
  definition: ReportDefinition;
}

/** floembi.app sunucusu istemcisi (Bearer oturum belirteci). */
export class WebClient {
  private http: HttpClient;

  constructor(baseUrl: string, token: string | null) {
    this.http = new HttpClient({
      baseUrl,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      unreachableMessage: "floembi.app sunucusuna ulaşılamadı. İnternet bağlantınızı kontrol edip sayfayı yenileyin.",
    });
  }

  login(email: string, password: string) {
    return this.http.request<{ token: string; user: WebUser }>("POST", "/api/auth/login", { email, password });
  }
  me() {
    return this.http.request<WebUser & { workspaces: WorkspaceInfo[] }>("GET", "/api/me");
  }
  content(workspaceId: number) {
    return this.http.request<WorkspaceContent>("GET", `/api/workspaces/${workspaceId}/content`);
  }
  sharedWithMe() {
    return this.http.request<SharedReport[]>("GET", "/api/shared-with-me");
  }
  report(id: number) {
    return this.http.request<PublishedReport>("GET", `/api/reports/${id}`);
  }
  reportQuery(id: number, q: VisualQuery) {
    return this.http.request<VisualResult>("POST", `/api/reports/${id}/query`, q);
  }
}
