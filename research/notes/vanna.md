# Vanna
- URL: https://github.com/vanna-ai/vanna
- Lisans: **MIT** — doğrulandı (kök `LICENSE`, "Copyright (c) 2024 Vanna.AI"). Alt lisans dosyası yok. Not: `src/vanna/integrations/premium/agent_memory/premium.py` (`CloudAgentMemory`) kod olarak MIT ama ücretli `https://api.vanna.ai` servisine bağlanıyor — kullanılmamalı.
- Dil: Python (+ `frontends/` web component `<vanna-chat>`)
- Sürüm: `pyproject.toml` → `version = "2.0.2"`
- Son commit tarihi: **2026-02-02** (yaklaşık 9,5 aydır commit yok → bakım riski)

## Ne yapıyor (3-5 cümle)
Doğal dil soruyu SQL'e çeviren, çalıştıran ve sonucu tablo/grafik olarak döndüren bir "text-to-SQL" çerçevesi. 0.x sürümü (şimdi `src/vanna/legacy/`) klasik RAG: DDL, dokümantasyon ve örnek soru-SQL çiftleri vektör deposuna eklenir, soruya benzerleri çekilip prompt'a konur. 2.0 sürümü (`src/vanna/core/`) bir **tool-calling ajan** mimarisine geçmiş: LLM `run_sql`, `visualize_data`, `agent_memory` gibi araçları çağırır; kullanıcı kimliği (`UserResolver`), araç bazlı erişim grupları, audit, middleware, streaming (SSE) ve FastAPI sunucu içerir. Çok sayıda LLM (OpenAI, Anthropic, Azure, Ollama, Google) ve vektör DB (Chroma, FAISS, Qdrant, pgvector, Milvus…) entegrasyonu var.

## Mimari (ana klasörler ve sorumlulukları, veri akışı)
| Klasör | Sorumluluk |
|---|---|
| `src/vanna/core/agent/agent.py` | Ajan döngüsü (LLM ↔ tool çağrıları, streaming) |
| `src/vanna/core/llm/base.py` | `LlmService` soyutlaması: `send_request`, `stream_request`, `validate_tools` |
| `src/vanna/core/tool/base.py` | `Tool[T]`: `name`, `description`, `access_groups`, `get_args_schema` (Pydantic), `execute` |
| `src/vanna/core/user/` (`resolver.py`, `request_context.py`) | İstekten kullanıcı/grup çözümleme (JWT/cookie) |
| `src/vanna/core/{audit,middleware,filter,enricher,system_prompt,observability}` | Kanca noktaları |
| `src/vanna/capabilities/agent_memory/base.py` | `AgentMemory`: `save_tool_usage`, `search_similar_usage`, `save_text_memory`, `search_text_memories` (RAG'in 2.0 karşılığı) |
| `src/vanna/capabilities/sql_runner/` + `integrations/{mssql,postgres,duckdb,...}/sql_runner.py` | SQL çalıştırıcılar |
| `src/vanna/tools/` | `run_sql.py`, `visualize_data.py` (Plotly), `agent_memory.py`, `python.py` |
| `src/vanna/legacy/base/base.py` | 0.x RAG: `generate_sql` L93, `get_similar_question_sql` L407, `get_related_ddl` L420, `get_sql_prompt` L586, `train` L1807 |
| `src/evals/` | SQL üretimi değerlendirme veri setleri/benchmark |

Akış (2.0): `HTTP/SSE → UserResolver → Agent → system prompt + memory araması → LlmService → tool call (run_sql, user context ile) → sonuç/grafik bileşenleri stream`.

## Floem BI için kritik kısımlar
- `src/vanna/core/llm/base.py` → Sağlayıcı bağımsız LLM arayüzü → Floem NLQ modülünde Claude/OpenAI/yerel model (Ollama) değiştirilebilirliği.
- `src/vanna/core/tool/base.py` (`access_groups`) + `core/user/` → Araç başına yetki ve kullanıcı bağlamı → NLQ'nun Floem RLS/kiracı bağlamıyla çalışması.
- `src/vanna/capabilities/agent_memory/base.py` → Başarılı soru→sorgu örneklerinin hafızası → Floem'de "onaylanmış soru → ölçü sorgusu" örnek kütüphanesi.
- `src/vanna/legacy/base/base.py` `get_sql_prompt` (L586) → DDL + doküman + örnek çiftlerden prompt kurma → Floem'de DDL yerine **semantik model** (tablo, ilişki, ölçü açıklamaları) bağlamı.
- `src/evals/datasets/sql_generation/` → Değerlendirme seti yapısı → Floem NLQ regresyon testleri.

## Semantik model / ölçü tanımı nasıl temsil ediliyor (varsa örnek şema)
Yok — yalnızca ham DDL, serbest metin dokümantasyon ve soru/SQL çiftleri (`add_ddl`, `add_documentation`, `add_question_sql`). Ölçü/ilişki kavramı bulunmuyor.

## Sorgu nasıl üretiliyor (varsa: ölçü + boyut + filtre → SQL akışı)
LLM doğrudan ham SQL yazar (legacy: tek prompt; 2.0: `run_sql` aracına SQL argümanı). Ölçü + boyut + filtre yapısı yok; doğrulama yalnızca çalıştırma hatasıyla.

## Alınacak fikirler
- Floem NLQ'da LLM **ham SQL değil, yapılandırılmış sorgu** üretmeli: `{measures:[...], dimensions:[...], filters:[...]}` → Floem derleyicisi → SQL. Böylece RLS, ölçü tanımları ve lehçe garanti edilir (Vanna'nın eksiği).
- Tool-calling ajan + Pydantic argüman şemaları; `access_groups` ile araç yetkilendirme.
- RAG bağlamı = semantik model meta verisi + onaylanmış örnek soru/sorgu çiftleri (kiracı başına vektör namespace'i).
- Eval veri seti ile sürekli ölçüm; streaming SSE yanıt bileşenleri.

## Kaçınılacaklar / zayıf yönler
- Ham SQL üretimi: RLS atlatma, yanlış join/çift sayım ve SQL injection benzeri riskler; ölçü tutarlılığı yok.
- 2.0 büyük yeniden yazım; legacy ile iki paralel API. Son commit Şubat 2026 → proje durgun olabilir.
- `CloudAgentMemory` ve hazır `vanna-components.js` CDN'i harici servise bağımlılık yaratır.
- Çok kiracılık tasarımı yüzeysel (kullanıcı bağlamı var, kiracı veri izolasyonu uygulamaya kalmış).

## Kullanım kararı: **Fikir al**
İleri aşama NLQ için mimari referans (LLM soyutlaması, tool/yetki modeli, örnek hafızası, eval). Floem NLQ semantik katman üzerine kurulmalı; Vanna bağımlılık olarak alınmamalı.
