// Monaco'yu yalnızca ihtiyaç duyulan parçalarla yükler (SQL ve DAX dilleri).
// monaco-editor 0.57'nin "exports" haritası: "monaco-editor/<yol>.js" → "esm/vs/<yol>.js"
import * as monaco from "monaco-editor/editor/editor.api.js";
import "monaco-editor/languages/definitions/sql/register.js";
import "monaco-editor/languages/definitions/msdax/register.js";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";

(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

export { monaco };
