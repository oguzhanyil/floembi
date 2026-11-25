import { useMemo, useRef, useState } from "react";
import {
  latestReports,
  type ItemKind,
  type PagedLibrary,
  type PagedReport,
  type PrintBand,
  type PrintItem,
  type PrintParameter,
} from "@floem/client";
import { PagedViewer } from "@floem/report";
import { useDocument } from "../document";
import { useClient } from "../api";
import { PagedCanvas } from "./PagedCanvas";
import { Choice, Num, PagedProperties } from "./PagedProperties";
import { bands, item, newReport, paperWidth, tools } from "./pagedModel";
import "./pagedDesigner.css";

export function PagedDesigner() {
  const { doc, editPaged, flushPaged } = useDocument(),
    client = useClient();
  const library = doc!.paginated ?? { reports: [] },
    catalog = latestReports(library),
    tables = doc!.model.tablolar;
  const tableFields = (name: string) =>
    tables
      .find((t) => t.ad === name)
      ?.sutunlar.filter((c) => !c.gizli)
      .map((c) => c.ad) ?? [];
  const [id, setId] = useState(catalog[0]?.id ?? ""),
    [source, setSource] = useState(tables[0]?.ad ?? "");
  const [starter, setStarter] = useState("canvas");
  const [bandKey, setBandKey] = useState("detail"),
    [selected, setSelected] = useState(""),
    [preview, setPreview] = useState(false);
  const [grid, setGrid] = useState(2),
    [zoom, setZoom] = useState(0.85),
    [draw, setDraw] = useState(false),
    [notice, setNotice] = useState("");
  const [version, setVersion] = useState(""),
    [group, setGroup] = useState(""),
    [sort, setSort] = useState(""),
    [param, setParam] = useState("");
  const past = useRef<PagedLibrary[]>([]),
    future = useRef<PagedLibrary[]>([]);
  const t = catalog.find((r) => r.id === id) ?? catalog[0],
    fields = tableFields(t?.table ?? source);
  const key = (b: PrintBand) => b.kind + (b.group || ""),
    b = t?.bands.find((x) => key(x) === bandKey) ?? t?.bands.find((x) => x.kind === "detail");
  const o = b?.objects.find((x) => x.id === selected),
    width = t ? paperWidth(t) : 186;
  const runner = useMemo(() => client.pagedRunner(doc!.id), [client, doc!.id]);
  function put(report: PagedReport) {
    past.current = [...past.current.slice(-49), library];
    future.current = [];
    const before = library.reports.findIndex((r) => r.id === report.id && r.version === report.version);
    editPaged({
      reports:
        before < 0
          ? [...library.reports, report]
          : library.reports.map((r, i) => (i === before ? report : r)),
    });
    setNotice("");
    setId(report.id);
  }
  const edit = (p: Partial<PagedReport>) => put({ ...t, ...p });
  const replace = (old: PrintBand, next: PrintBand) =>
    edit({ bands: t.bands.map((v) => (v === old ? next : v)) });
  function valid(band: PrintBand) {
    const flow = band.objects.filter((o) => o.kind === "subreport" || o.kind === "crossTab");
    if (
      flow.length &&
      (flow.length > 1 ||
        !["detail", "reportFooter", "groupFooter"].includes(band.kind) ||
        band.objects.some((v) => v !== flow[0] && v.y + v.h > flow[0].y + 0.01))
    ) {
      setNotice(
        "Alt rapor ve çapraz tablo, detay veya toplam bölümünün sonunda yer alır. Bu nesne için üstte boş alan bırakın.",
      );
      return false;
    }
    return true;
  }
  const patch = (band: PrintBand, id: string, p: Partial<PrintItem>) => {
    const next = { ...band, objects: band.objects.map((v) => (v.id === id ? { ...v, ...p } : v)) };
    if (valid(next)) replace(band, next);
  };
  function move(from: PrintBand, to: PrintBand, obj: PrintItem, x: number, y: number) {
    if (obj.locked || from === to) return;
    const moved = {
      ...obj,
      x: Math.max(0, Math.min(width - obj.w, x)),
      y: Math.max(0, Math.min(400 - obj.h, y)),
    };
    const next = { ...to, height: Math.max(to.height, moved.y + moved.h), objects: [...to.objects, moved] };
    if (!valid(next)) return;
    edit({
      bands: t.bands.map((v) =>
        v === from ? { ...v, objects: v.objects.filter((i) => i.id !== obj.id) } : v === to ? next : v,
      ),
    });
    setBandKey(key(to));
    setSelected(obj.id);
  }
  function duplicate(b: PrintBand, o: PrintItem) {
    const y = Math.min(400 - o.h, o.y + 3),
      copy = {
        ...structuredClone(o),
        id: crypto.randomUUID(),
        locked: false,
        x: Math.min(width - o.w, o.x + 3),
        y,
      };
    const next = { ...b, height: Math.max(b.height, y + o.h), objects: [...b.objects, copy] };
    if (valid(next)) {
      replace(b, next);
      setSelected(copy.id);
    }
  }
  function remove(b: PrintBand, o: PrintItem) {
    if (!o.locked) {
      replace(b, { ...b, objects: b.objects.filter((v) => v.id !== o.id) });
      setSelected("");
    }
  }
  function history(redo: boolean) {
    const from = redo ? future : past,
      to = redo ? past : future;
    const before = from.current.pop();
    if (before) {
      to.current.push(library);
      editPaged(before);
      setNotice("");
    }
  }
  function add(band: PrintBand, kind: ItemKind, x = 0, y = 0, field = fields[0], w?: number, h?: number) {
    const flow = kind === "subreport" || kind === "crossTab",
      existing = band.objects.find((o) => o.kind === "subreport" || o.kind === "crossTab");
    if (flow && (!["detail", "groupFooter", "reportFooter"].includes(band.kind) || existing)) {
      setNotice("Alt rapor ve çapraz tablo için boş bir detay veya toplam bölümü sonu seçin.");
      return;
    }
    if (flow) y = Math.max(y, 0, ...band.objects.map((v) => v.y + v.h));
    const height = h ?? (kind === "barcode" ? 15 : kind === "line" ? 0.4 : 7),
      limit = existing?.y ?? 400;
    if (!flow && y + height > limit) {
      setNotice("Bu nesneyi bölümdeki alt raporun veya çapraz tablonun üstüne yerleştirin.");
      return;
    }
    const child = catalog.find((r) => r.id !== t.id);
    const obj = item(kind, {
      field: kind === "field" || kind === "barcode" || flow ? field : "",
      text: kind === "text" ? "Metin" : "",
      x: Math.max(0, Math.min(x, width - 1)),
      y: Math.max(0, Math.min(y, 400 - height)),
      h: height,
      w: Math.min(
        w ?? (flow ? width : kind === "line" ? 65 : 42),
        width - Math.max(0, Math.min(x, width - 1)),
      ),
      ...(kind === "formula" ? { formula: { op: "field", field: fields[0] } } : {}),
      ...(kind === "subreport"
        ? { target: child?.id ?? "", childField: tableFields(child?.table ?? "")[0] ?? "" }
        : {}),
      ...(kind === "crossTab"
        ? {
            column: fields[1] ?? fields[0],
            measure: fields.find((f) => /total|tutar|miktar|quantity/i.test(f)) ?? fields[0],
          }
        : {}),
    });
    replace(band, { ...band, height: Math.max(band.height, obj.y + obj.h), objects: [...band.objects, obj] });
    setBandKey(key(band));
    setSelected(obj.id);
    setDraw(false);
  }
  function formatPage(change: Partial<PagedReport>) {
    const next = { ...t, ...change },
      w = paperWidth(next);
    const oldHeight=paperWidth({...t,landscape:!t.landscape});
    const newHeight=paperWidth({...next,landscape:!next.landscape});
    next.bands = t.bands.map((b) => {
      const height=b.height===oldHeight ? newHeight : Math.min(b.height,newHeight);
      return {...b,height,objects:b.objects.map(o=>({...o,
        x: Math.min(o.x, Math.max(0, w-o.w)), w:Math.min(o.w,w),
        y: Math.min(o.y, Math.max(0,height-o.h)), h:Math.min(o.h,height)
      }))};
    });
    put(next);
  }
  const versions = library.reports.filter((r) => r.id === t?.id).sort((a, b) => b.version - a.version);
  return (
    <div className="pg-studio">
      <div className="pg-toolbar">
        <Choice
          label="Kütüphane"
          options={catalog.map((r) => [r.id, (r.category ? r.category + " / " : "") + r.name])}
          value={t?.id}
          change={(v) => {
            setId(v);
            setSelected("");
            setBandKey("detail");
            setPreview(false);
            setVersion("");
          }}
        />
        <Choice
          label="Yeni rapor kaynağı"
          empty="Bağlantısız belge"
          value={source}
          options={tables.map((v) => v.ad)}
          change={setSource}
        />
        <Choice
          label="Başlangıç düzeni"
          value={source ? starter : "canvas"}
          options={
            source
              ? [
                  ["canvas", "Serbest sayfa"],
                  ["record", "Her kayıt için bir form"],
                  ["list", "Veri listesi"],
                ]
              : [["canvas", "Serbest sayfa"]]
          }
          change={setStarter}
        />
        <button
          onClick={() => {
            const mode = source ? starter : "canvas";
            put(newReport(source, tableFields(source), mode));
            setPreview(false);
            setBandKey(mode === "canvas" ? "reportHeader" : "detail");
            setSelected("");
          }}
        >
          Yeni rapor
        </button>
        {t && (
          <>
            <button
              onClick={() => {
                put({
                  ...structuredClone(t),
                  id: crypto.randomUUID(),
                  name: t.name + " kopyası",
                  version: 1,
                });
                setPreview(false);
              }}
            >
              Kopyala
            </button>
            <button disabled={!past.current.length || preview} onClick={() => history(false)}>
              Geri al
            </button>
            <button disabled={!future.current.length || preview} onClick={() => history(true)}>
              Yinele
            </button>
            <button aria-pressed={!preview} onClick={() => setPreview(false)}>
              Tasarım
            </button>
            <button
              aria-pressed={preview}
              onClick={async () => {
                try {
                  await flushPaged();
                  setNotice("");
                  setPreview(true);
                } catch (e) {
                  setNotice(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              Baskı önizleme
            </button>
          </>
        )}
      </div>
      {notice && (
        <p className="pg-notice" role="alert">
          {notice}
        </p>
      )}
      {!t || !b ? (
        <p className="pg-empty">
          <strong>Yeni rapor</strong> ile sayfa açın. Metin kutularını ve çizgileri sayfaya
          sürükleyebilirsiniz.
        </p>
      ) : preview ? (
        <PagedViewer key={t.id} library={library} runner={runner} initial={t.id} />
      ) : (
        <div className="pg-work">
          <aside className="pg-panel">
            <fieldset>
              <legend>Rapor özellikleri</legend>
              <label>
                Rapor adı
                <input value={t.name} onChange={(e) => edit({ name: e.target.value })} />
              </label>
              <label>
                Kategori
                <input value={t.category} onChange={(e) => edit({ category: e.target.value })} />
              </label>
              {!t.table && (
                <Choice
                  label="Modele bağla"
                  empty="Bağlantısız belge"
                  value=""
                  options={tables.map((v) => v.ad)}
                  change={(table) => edit({ table })}
                />
              )}
              <div className="pg-pair">
                <Choice
                  label="Kâğıt"
                  value={t.paper}
                  options={["A4", "A3"]}
                  change={(v) => formatPage({ paper: v as PagedReport["paper"] })}
                />
                <Choice
                  label="Yön"
                  value={t.landscape ? "Yatay" : "Dikey"}
                  options={["Dikey", "Yatay"]}
                  change={(v) => formatPage({ landscape: v === "Yatay" })}
                />
              </div>
              <Num
                label="Kenar boşluğu (mm)"
                value={t.margin}
                max={50}
                change={(margin) => formatPage({ margin })}
              />
              <div className="pg-pair">
                <Choice
                  label="Izgara (mm)"
                  value={String(grid)}
                  options={[["0", "Kapalı"], "1", "2", "5"]}
                  change={(s) => setGrid(+s)}
                />
                <Choice
                  label="Yakınlaştırma"
                  value={String(zoom)}
                  options={[
                    [".6", "%60"],
                    ["0.85", "%85"],
                    ["1", "%100"],
                    ["1.25", "%125"],
                  ].map(([k, l]) => [String(+k), l])}
                  change={(s) => setZoom(+s)}
                />
              </div>
            </fieldset>
            <fieldset>
              <legend>Nesneler</legend>
              <div className="pg-palette">
                {Object.entries(tools).map(([k, n]) => (
                  <button
                    key={k}
                    draggable
                    disabled={!fields.length && ["field", "formula", "subreport", "crossTab"].includes(k)}
                    onDragStart={(e) => e.dataTransfer.setData("floem-tool", k)}
                    onClick={() =>
                      add(
                        b,
                        k as ItemKind,
                        0,
                        Math.min(
                          390,
                          Math.max(0, ...b.objects.map((v) => v.y + v.h)) + (b.objects.length ? 2 : 0),
                        ),
                      )
                    }
                  >
                    {n}
                  </button>
                ))}
              </div>
              <button aria-pressed={draw} onClick={() => setDraw(!draw)}>
                Çizgiyi sürükleyerek çiz
              </button>
            </fieldset>
            <details open>
              <summary>Veri alanları · {t.table}</summary>
              <div className="pg-fields">
                {fields.map((f) => (
                  <button
                    key={f}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("floem-field", f)}
                    onClick={() => add(b, "field", 0, 0, f)}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </details>
            <details>
              <summary>Gruplama ve sıralama</summary>
              {t.groups.map((g, i) => (
                <div key={g.field} className="pg-entry">
                  <b>
                    {i + 1}. {g.field}
                  </b>
                  {(["desc", "repeat", "newPage"] as const).map((prop, k) => (
                    <label key={prop}>
                      <input
                        type="checkbox"
                        checked={g[prop] ?? prop === "repeat"}
                        onChange={(e) =>
                          edit({
                            groups: t.groups.map((v, j) =>
                              i === j ? { ...v, [prop]: e.target.checked } : v,
                            ),
                          })
                        }
                      />
                      {["Azalan", "Başlığı yinele", "Yeni sayfada başlat"][k]}
                    </label>
                  ))}
                  <button
                    onClick={() =>
                      edit({
                        groups: t.groups.filter((x) => x !== g),
                        bands: t.bands.filter((b) => b.group !== g.field),
                      })
                    }
                  >
                    Grubu kaldır
                  </button>
                </div>
              ))}
              <Choice
                label="Grup alanı"
                empty="Alan seçin"
                value={group}
                options={fields.filter((f) => !t.groups.some((g) => g.field === f))}
                change={setGroup}
              />
              <button
                disabled={!fields.includes(group) || t.groups.some((g) => g.field === group)}
                onClick={() => {
                  edit({
                    groups: [...t.groups, { field: group, repeat: true }],
                    bands: [
                      ...t.bands,
                      {
                        kind: "groupHeader",
                        group,
                        height: 9,
                        objects: [item("field", { field: group, bold: true, w: width, h: 8 })],
                      },
                      { kind: "groupFooter", group, height: 8, objects: [] },
                    ],
                  });
                  setGroup("");
                }}
              >
                Grup ekle
              </button>
              {t.sort.map((s, i) => (
                <div className="pg-entry" key={i}>
                  {s.field}
                  <label>
                    <input
                      type="checkbox"
                      checked={!!s.desc}
                      onChange={(e) =>
                        edit({ sort: t.sort.map((v, j) => (i === j ? { ...v, desc: e.target.checked } : v)) })
                      }
                    />
                    Azalan
                  </label>
                  <button onClick={() => edit({ sort: t.sort.filter((_, j) => i !== j) })}>Kaldır</button>
                </div>
              ))}
              <Choice
                label="Sıralama alanı"
                value={sort}
                empty="Alan seçin"
                options={fields}
                change={setSort}
              />
              <button
                disabled={!fields.includes(sort) || t.sort.some((s) => s.field === sort)}
                onClick={() => {
                  edit({ sort: [...t.sort, { field: sort }] });
                  setSort("");
                }}
              >
                Sıralama ekle
              </button>
            </details>
            <details>
              <summary>Parametreler</summary>
              {t.params.map((p, i) => {
                const set = (v: Partial<PrintParameter>) =>
                  edit({ params: t.params.map((s, j) => (i === j ? { ...s, ...v } : s)) });
                return (
                  <div key={i} className="pg-entry">
                    <b>{p.field}</b>
                    <label>
                      Parametre adı
                      <input value={p.label} onChange={(e) => set({ label: e.target.value })} />
                    </label>
                    <label>
                      Başlangıç değeri
                      <input
                        value={String(p.default ?? "")}
                        onChange={(e) => set({ default: e.target.value })}
                      />
                    </label>
                    <Choice
                      label="Girdi türü"
                      value={p.kind}
                      options={[
                        ["choice", "Dinamik seçim"],
                        ["date", "Tarih"],
                        ["number", "Sayı"],
                        ["text", "Metin"],
                      ]}
                      change={(v) => set({ kind: v as PrintParameter["kind"] })}
                    />
                    <Choice
                      label="Filtre"
                      value={p.op}
                      options={[
                        ["eq", "Eşit"],
                        ["ge", "En az / başlangıç"],
                        ["le", "En çok / bitiş"],
                        ["contains", "İçerir"],
                      ]}
                      change={(v) => set({ op: v as PrintParameter["op"] })}
                    />
                    <button onClick={() => edit({ params: t.params.filter((_, j) => j !== i) })}>
                      Parametreyi kaldır
                    </button>
                  </div>
                );
              })}
              <Choice
                label="Parametre alanı"
                value={param}
                empty="Alan seçin"
                options={fields}
                change={setParam}
              />
              <button
                disabled={!fields.includes(param)}
                onClick={() => {
                  let label = param;
                  let n = 2;
                  while (t.params.some((p) => p.label === label)) label = param + " " + n++;
                  edit({ params: [...t.params, { field: param, label, kind: "choice", op: "eq" }] });
                  setParam("");
                }}
              >
                Parametre ekle
              </button>
            </details>
            <details>
              <summary>Sürümler · v{t.version}</summary>
              <button onClick={() => put({ ...structuredClone(t), version: t.version + 1 })}>
                Yeni sürüm başlat
              </button>
              <Choice
                label="Önceki sürüm"
                empty="Sürüm seçin"
                value={version}
                options={versions.filter((r) => r.version < t.version).map((r) => String(r.version))}
                change={setVersion}
              />
              <button
                disabled={!versions.some((v) => v.version === Number(version) && v.version < t.version)}
                onClick={() => {
                  const old = versions.find((r) => r.version === +version)!;
                  put({ ...structuredClone(old), version: t.version + 1 });
                  setVersion("");
                }}
              >
                Sürümü geri yükle
              </button>
            </details>
          </aside>
          <PagedCanvas
            t={t}
            band={b}
            selectBand={(v) => setBandKey(key(v))}
            selected={selected}
            select={setSelected}
            add={add}
            change={patch}
            move={move}
            duplicate={duplicate}
            remove={remove}
            grid={grid}
            zoom={zoom}
            draw={draw}
          />
          <aside className="pg-panel">
            <fieldset>
              <legend>
                {bands[b.kind]} {b.group}
              </legend>
              <Num
                label="Bölüm yüksekliği (mm)"
                min={Math.max(0, ...b.objects.map((o) => o.y + o.h))}
                max={400}
                value={b.height}
                change={(height) => replace(b, { ...b, height })}
              />
            </fieldset>
            <Choice
              label="Bölümdeki nesneler"
              empty="Nesne seçin"
              options={b.objects.map((v, i) => [v.id, i + 1 + ". " + (v.text || v.field || tools[v.kind])])}
              value={selected}
              change={setSelected}
            />
            {o && (
              <>
                <label>
                  <input
                    type="checkbox"
                    checked={!!o.locked}
                    onChange={(e) => patch(b, o.id, { locked: e.target.checked })}
                  />{" "}
                  Nesneyi kilitle
                </label>
                <fieldset disabled={o.locked}>
                  <Choice
                    label="Bölüme taşı"
                    value={key(b)}
                    options={t.bands.map((v) => [key(v), bands[v.kind] + " " + (v.group || "")])}
                    change={(v) => move(b, t.bands.find((s) => key(s) === v)!, o, o.x, 0)}
                  />
                  <div className="pg-actions">
                    <button onClick={() => duplicate(b, o)}>Çoğalt</button>
                    <button
                      onClick={() => replace(b, { ...b, objects: [...b.objects.filter((v) => v !== o), o] })}
                    >
                      Öne getir
                    </button>
                    <button
                      onClick={() => replace(b, { ...b, objects: [o, ...b.objects.filter((v) => v !== o)] })}
                    >
                      Arkaya gönder
                    </button>
                  </div>
                  <PagedProperties
                    t={t}
                    b={b}
                    o={o}
                    fields={fields}
                    library={catalog}
                    tableFields={tableFields}
                    edit={(p) => patch(b, o.id, p)}
                    remove={() => remove(b, o)}
                  />
                </fieldset>
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
