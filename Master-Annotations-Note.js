/*
 * @file Master-Annotations-Note.js
 * @author https://github.com/marvin-bay 
 * @version 0.1
 * @usage Select one or multiple parent item(s) and activate in contex menu.
 * @description Creates or updates a “master note” for each selected 
 * Zotero item by collecting all annotations from its PDF attachments. 
 * It detects existing master notes via a hidden marker, and uses 
 * Zotero’s native serialization 
 * (Zotero.Annotations.toJSON + EditorInstanceUtilities.serializeAnnotations) 
 * to generate authentic HTML with data-annotation/data-citation metadata. 
 * The note gets a standardized title <Author>_<Year>_Notes (with a date header), 
 * and all annotations—including comments—are written into the note. Designed to 
 * work with Actions & Tags, with a public marker (no personal handle).
 * @see https://github.com/crnkv/Zotero-Action-Scripts-Collection
 * suggested Menu Label: Create/Update Master-Note from Annotations
 */

const DEBUG = true;
const MASTER_MARKER = "<!-- master-annotations-note -->";
const LOG_PREFIX = "[AT-master-annotations-note] ";
let LAST_FETCH_DEBUG = []; // sammelt Ablauf beim Laden der Annotationen
let LAST_SERIALIZE_DEBUG = []; // sammelt Ablauf bei der Serialisierung

// Ergebnisse für Popup
const RESULTS = [];

/**
 * Debug-Logging.
 */
function logDebug(msg) {
  if (!DEBUG) return;
  try {
    Zotero.debug(LOG_PREFIX + String(msg));
  } catch (e) {
    // ignore
  }
}

/**
 * Einfache HTML-Escaping-Funktion.
 */
function escapeHTML(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Sanitize für Titel-/Datei-Strings:
 * - Leerzeichen → _
 * - problematische Zeichen entfernen
 */
function sanitizeForTitle(s) {
  if (!s) return "";
  let out = String(s);
  out = out.replace(/\s+/g, "_");
  out = out.replace(/[\/\\:\*\?"<>\|]+/g, "");
  return out;
}

/**
 * Holt Autor (Nachname des ersten Creators) + Jahr aus dem Item.
 * Fallbacks:
 * - UnknownAuthor / UnknownYear
 */
function extractAuthorAndYear(item) {
  let author = "UnknownAuthor";
  let year = "UnknownYear";

  try {
    let creator;
    if (typeof item.getCreatorJSON === "function") {
      creator = item.getCreatorJSON(0);
    } else if (typeof item.getCreator === "function") {
      creator = item.getCreator(0);
    }
    if (creator && creator.lastName) {
      author = sanitizeForTitle(creator.lastName);
    }
  } catch (e) {
    logDebug(
      "extractAuthorAndYear: Fehler bei Creator: " +
        (e && e.message ? e.message : e)
    );
  }

  try {
    const dateField = item.getField ? item.getField("date") : "";
    if (dateField) {
      const m = /(\d{4})/.exec(dateField);
      if (m && m[1]) {
        year = m[1];
      }
    }
  } catch (e2) {
    logDebug(
      "extractAuthorAndYear: Fehler bei dateField: " +
        (e2 && e2.message ? e2.message : e2)
    );
  }

  return { author, year };
}

/**
 * Erzeugt den sichtbaren Titel im Format:
 *   <Autor>_<Jahr>_Notes
 */
function buildNoteTitle(item) {
  const meta = extractAuthorAndYear(item);
  const title = meta.author + "_" + meta.year + "_Notes";
  logDebug(
    "buildNoteTitle: author=" +
      meta.author +
      ", year=" +
      meta.year +
      ", title=" +
      title
  );
  return title;
}

/**
 * Fallback: baut zotero://open-URI für eine Annotation
 * aus attachmentURI (http://zotero.org/groups/.../items/KEY),
 * pageLabel und annotationKey.
 */
function buildAnnotationOpenURI(libraryID, attachmentKey, pageLabel, annotationKey) {
  if (!attachmentKey || annotationKey === undefined || annotationKey === null) {
    logDebug("buildAnnotationOpenURI: fehlender attachmentKey oder annotationKey");
    return "";
  }
  // libraryID: 0 => users/0, sonst groups/<id>
  const scope =
    libraryID && Number(libraryID) > 0
      ? "groups/" + libraryID
      : "users/0";
  let base = "zotero://open-pdf/" + scope + "/items/" + attachmentKey;
  const params = [];
  if (pageLabel) {
    params.push("page=" + encodeURIComponent(pageLabel));
  }
  params.push("annotation=" + encodeURIComponent(String(annotationKey)));
  const sep = base.indexOf("?") === -1 ? "?" : "&";
  return base + sep + params.join("&");
}

/**
 * Holt Annotationen für ein Parent-Item über alle Attachments.
 */
async function fetchAnnotationsForParentItem(parentItem) {
  logDebug(
    "fetchAnnotationsForParentItem: START für parent.id=" + parentItem.id
  );

  LAST_FETCH_DEBUG = [];
  LAST_FETCH_DEBUG.push("parent.id=" + parentItem.id);

  const result = [];

  try {
    const attachmentIDs =
      typeof parentItem.getAttachments === "function"
        ? parentItem.getAttachments()
        : [];

    if (!attachmentIDs || !attachmentIDs.length) {
      logDebug(
        "fetchAnnotationsForParentItem: keine Attachments für Item " +
          parentItem.id
      );
      LAST_FETCH_DEBUG.push("no attachments found");
      return result;
    }

    LAST_FETCH_DEBUG.push("attachmentIDs=" + attachmentIDs.join(","));

    logDebug(
      "fetchAnnotationsForParentItem: attachmentIDs length=" +
        attachmentIDs.length
    );

    const attachments = await Zotero.Items.getAsync(attachmentIDs);

    // URI des Parent-Items (für Citation)
    let parentItemURI = "";
    try {
      if (Zotero.URI && typeof Zotero.URI.getItemURI === "function") {
        parentItemURI = Zotero.URI.getItemURI(parentItem);
      }
    } catch (eURI) {
      // ignore
    }

    for (let i = 0; i < attachments.length; i++) {
      const att = attachments[i];
      if (!att) {
        logDebug(
          "fetchAnnotationsForParentItem: Attachment[" + i + "] ist null"
        );
        continue;
      }

      logDebug(
        "fetchAnnotationsForParentItem: Attachment[" +
          i +
          "] id=" +
          att.id +
          ", contentType=" +
          att.attachmentContentType
      );

      let attURI = "";
      let attachmentKey = "";
      try {
        if (Zotero.URI && typeof Zotero.URI.getItemURI === "function") {
          attURI = Zotero.URI.getItemURI(att);
        }
        if (typeof att.getField === "function") {
          attachmentKey = att.getField("key") || "";
        }
      } catch (eAttURI) {
        // ignore
      }

      let annos = [];
      try {
        if (typeof att.getAnnotations === "function") {
          const tmp = att.getAnnotations();
          annos = await tmp; // Promise oder Array
          logDebug(
            "fetchAnnotationsForParentItem: Attachment[" +
              i +
              "] getAnnotations length=" +
              (annos ? annos.length : 0)
          );
          LAST_FETCH_DEBUG.push(
            `att[${i}] id=${att.id} anns=${annos ? annos.length : 0}`
          );
          // Falls nur IDs geliefert werden: Items nachladen
          if (annos && annos.length && (typeof annos[0] === "number" || typeof annos[0] === "string")) {
            annos = await Zotero.Items.getAsync(annos);
            logDebug(
              "fetchAnnotationsForParentItem: Attachment[" +
                i +
                "] IDs materialisiert, length=" +
                (annos ? annos.length : 0)
            );
            LAST_FETCH_DEBUG.push(
              `att[${i}] IDs materialisiert -> ${annos ? annos.length : 0}`
            );
          }
          // Filter: nur Annotationen (keine ink)
          annos = (annos || []).filter(
            (x) => x && typeof x.isAnnotation === "function" && x.isAnnotation() && x.annotationType !== "ink"
          );
          for (let a of annos) {
            result.push(a);
          }
        } else {
          logDebug(
            "fetchAnnotationsForParentItem: Attachment[" +
              i +
              "] hat keine getAnnotations()-Methode"
          );
        }
      } catch (e) {
        logDebug(
          "fetchAnnotationsForParentItem: Fehler bei getAnnotations für Attachment " +
            att.id +
            ": " +
            (e && e.message ? e.message : e)
        );
      }
    }

    logDebug(
      "fetchAnnotationsForParentItem: gesamt " +
        result.length +
        " Annotationen gesammelt für Item " +
        parentItem.id
    );
    LAST_FETCH_DEBUG.push(
      "total annotations collected=" + result.length
    );
  } catch (e) {
    logDebug(
      "fetchAnnotationsForParentItem: Fehler: " +
        (e && e.message ? e.message : e)
    );
    LAST_FETCH_DEBUG.push(
      "error: " + (e && e.message ? e.message : e)
    );
  }

  logDebug(
    "fetchAnnotationsForParentItem: ENDE, result length=" + result.length
  );
  return result;
}

/**
 * Stellt sicher, dass für Bild/Ink-Annotationen ein Cache-PNG existiert,
 * damit Zotero.Annotations.toJSON() eine data:URL zurückliefert.
 * Rendert fehlende Caches einmal pro Attachment via PDFWorker.
 */
async function ensureImageAnnotationCaches(annotations) {
  const renderedAttachmentIDs = new Set();

  for (const ann of annotations) {
    if (!ann || !["image", "ink"].includes(ann.annotationType)) {
      continue;
    }
    try {
      const hasCache = await Zotero.Annotations.hasCacheImage(ann);
      if (hasCache) {
        continue;
      }
      const attachmentID = ann.parentID;
      if (!attachmentID || renderedAttachmentIDs.has(attachmentID)) {
        continue;
      }
      renderedAttachmentIDs.add(attachmentID);
      await Zotero.PDFWorker.renderAttachmentAnnotations(attachmentID);
      logDebug(
        `ensureImageAnnotationCaches: Cache gerendert für attachmentID=${attachmentID}`
      );
    } catch (e) {
      logDebug(
        "ensureImageAnnotationCaches: Fehler beim Rendern: " +
          (e && e.message ? e.message : e)
      );
    }
  }
}

/**
 * Wandelt data:URL -> Blob (PNG o.ä.).
 */
function dataURLToBlob(dataurl) {
  if (!dataurl || typeof dataurl !== "string") return null;
  const parts = dataurl.split(",");
  if (!parts[0] || !parts[0].includes("base64")) return null;
  const mimeMatch = parts[0].match(/:(.*?);/);
  const mime = mimeMatch && mimeMatch[1] ? mimeMatch[1] : "application/octet-stream";
  const bstr = atob(parts[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

/**
 * Baut zotero://open-pdf Link aus Annotation-JSON (attachmentURI + annotationKey).
 */
function buildOpenURIFromJSONAnnotation(ann) {
  if (!ann || !ann.attachmentURI || !ann.id) return null;
  try {
    const m = ann.attachmentURI.match(/\/(users|groups)\/(\d+)\/items\/([A-Z0-9]+)/i);
    if (!m) return null;
    const scope = m[1] === "groups" ? `groups/${m[2]}` : "users/0";
    const attachmentKey = m[3];
    const params = [`annotation=${encodeURIComponent(String(ann.id))}`];
    if (ann.pageLabel) {
      params.unshift(`page=${encodeURIComponent(ann.pageLabel)}`);
    }
    return `zotero://open-pdf/${scope}/items/${attachmentKey}?${params.join("&")}`;
  } catch (e) {
    logDebug("buildOpenURIFromJSONAnnotation: Fehler " + (e && e.message ? e.message : e));
    return null;
  }
}

/**
 * Umhüllt <img data-annotation> mit Links, die zur Annotation springen.
 */
function buildSelectURIFromCitationURI(uri) {
  if (!uri || typeof uri !== "string") return null;
  const m = uri.match(/zotero\.org\/(users|groups)\/(\d+)\/items\/([A-Z0-9]+)/i);
  if (!m) return null;
  const scope = m[1] === "groups" ? `groups/${m[2]}` : `users/${m[2]}`;
  return `zotero://select/${scope}/items/${m[3]}`;
}

function wrapImagesWithLinks(serializedHTML, annMap, selectURIByAnnotation = new Map()) {
  if (!serializedHTML || !annMap || annMap.size === 0) return serializedHTML;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(serializedHTML, "text/html");
    // Suche nach beliebigen Elementen mit data-annotation (nicht nur <img>)
    doc.querySelectorAll("[data-annotation]").forEach((node) => {
      const annEncoded = node.getAttribute("data-annotation");
      if (!annEncoded) return;
      let annKey = null;
      try {
        const annObj = JSON.parse(decodeURIComponent(annEncoded));
        annKey = annObj.annotationKey || annObj.id;
      } catch (_) {}
      if (!annKey) return;

      const ann = annMap.get(annKey);
      const href = buildOpenURIFromJSONAnnotation(ann);

      // Ziel-<img> bestimmen (kann das Node selbst oder ein Kind sein)
      const img =
        node.tagName && node.tagName.toLowerCase() === "img"
          ? node
          : node.querySelector("img");
      if (!img) return;

      // src und alt sauber setzen
      const src =
        ann?.imageAttachmentKey
          ? `attachments/${ann.imageAttachmentKey}.png`
          : ann?.image || img.getAttribute("src") || "";
      if (src) {
        img.setAttribute("src", src);
      }
      img.setAttribute("alt", "image");
      img.removeAttribute("width");
      img.removeAttribute("height");

      // Bild klickbar machen
      let link = img.parentElement && img.parentElement.tagName.toLowerCase() === "a"
        ? img.parentElement
        : null;
      if (!link) {
        link = doc.createElement("a");
        link.appendChild(img.cloneNode(true));
        img.replaceWith(link);
      }
      link.setAttribute("href", href);

      // Einfügepunkt: Absatz um das Bild, sonst der Link selbst
      const insertionAnchor = link.closest("p") || link;

      // Zusätzliche Zeile „Open Note“ anlegen
      const openP = doc.createElement("p");
      if (href) {
        const openLink = doc.createElement("a");
        openLink.setAttribute("href", href);
        openLink.textContent = "Open Note";
        openP.appendChild(openLink);
      } else {
        const openSpan = doc.createElement("span");
        openSpan.textContent = "Open Note (kein Link verfügbar)";
        openP.appendChild(openSpan);
        logDebug("wrapImagesWithLinks: kein href für annKey=" + annKey);
      }

      // Bestehende, durch früheren Lauf erzeugte Links entfernen
      const parent = insertionAnchor.parentNode || doc.body;
      Array.from(parent.querySelectorAll("[data-annotation-ref='" + annKey + "']")).forEach((el) => el.remove());

      openP.setAttribute("data-annotation-ref", annKey);

      parent.insertBefore(openP, insertionAnchor.nextSibling);
    });
    return doc.body.innerHTML;
  } catch (e) {
    logDebug("wrapImagesWithLinks: Fehler " + (e && e.message ? e.message : e));
    return serializedHTML;
  }
}

/**
 * Importiert Bild-Annotationen als eingebettetes Attachment, setzt imageAttachmentKey
 * und entfernt das inline-Bild, sodass serializeAnnotations ein <img data-attachment-key> schreibt.
 */
async function importImagesForAnnotations(jsonAnnotations, noteItem, existingImageMap) {
  for (const ann of jsonAnnotations) {
    if (!ann || ann.imageAttachmentKey || !ann.image) {
      continue;
    }
    // Wenn es bereits einen Anhang zu dieser Annotation gibt, wiederverwenden
    const existingKey = existingImageMap?.get(ann.id);
    if (existingKey) {
      ann.imageAttachmentKey = existingKey;
      delete ann.image;
      continue;
    }
    try {
      const blob = dataURLToBlob(ann.image);
      if (!blob) {
        continue;
      }
      const attachment = await Zotero.Attachments.importEmbeddedImage({
        blob,
        parentItemID: noteItem.id,
        saveOptions: {
          notifierData: {
            noteEditorID: "master-annotations-note"
          }
        }
      });
      if (attachment && attachment.key) {
        ann.imageAttachmentKey = attachment.key;
        logDebug(
          `importImagesForAnnotations: imageAttachmentKey gesetzt (${attachment.key}) für annotation ${ann.id}`
        );
      }
    } catch (e) {
      logDebug(
        "importImagesForAnnotations: Fehler beim Import: " +
          (e && e.message ? e.message : e)
      );
    }
  }
}

async function generateNoteHTMLFromAnnotations(parentItem, noteItem, visibleTitle, existingImageMap = new Map()) {
  logDebug(
    "generateNoteHTMLFromAnnotations: START für parent.id=" +
      parentItem.id +
      ", title=" +
      visibleTitle
  );

  const annItems = await fetchAnnotationsForParentItem(parentItem);
  logDebug(
    "generateNoteHTMLFromAnnotations: Anzahl Annotationen=" +
      annItems.length
  );
  await ensureImageAnnotationCaches(annItems);
  LAST_SERIALIZE_DEBUG = [];
  LAST_SERIALIZE_DEBUG.push("annotations.length=" + annItems.length);

  const lines = [];
  const parentTitle = parentItem.getField
    ? parentItem.getField("title") || "(ohne Titel)"
    : "(ohne Titel)";

  // Sichtbarer Titel analog Zotero-Template (h1 + Datum)
  const dateStr = formatDateTimeLocal(new Date());
  lines.push(
    `<h1>${escapeHTML(visibleTitle)}<br/>(${escapeHTML(dateStr)})</h1>`
  );

  // Marker als versteckter Kommentar
  lines.push(MASTER_MARKER);

  if (!annItems.length) {
    lines.push("<p><em>Keine Annotationen gefunden.</em></p>");
    if (LAST_FETCH_DEBUG && LAST_FETCH_DEBUG.length) {
      lines.push(
        "<pre>" + escapeHTML(LAST_FETCH_DEBUG.join("\n")) + "</pre>"
      );
    }
    logDebug("generateNoteHTMLFromAnnotations: ENDE (keine Annotationen)");
    return wrapWithCitationContainer(lines.join("\n"), []);
  }

  // JSON über Zotero.Annotations.toJSON + Zusatzfelder wie Zotero selbst
  const jsonAnnotations = [];
  const annMap = new Map();
  const attachmentURIByID = new Map();
  const selectURIByAnnotation = new Map();
  for (let ann of annItems) {
    try {
      const j = await Zotero.Annotations.toJSON(ann);
      j.attachmentItemID = ann.parentID;
      j.id = ann.key;
      // Fehlende attachmentURI nachreichen
      try {
        if (!j.attachmentURI && ann.parentID) {
          let attURI = attachmentURIByID.get(ann.parentID);
          if (!attURI) {
            const attItem = await Zotero.Items.getAsync(ann.parentID);
            if (attItem && Zotero.URI && typeof Zotero.URI.getItemURI === "function") {
              attURI = Zotero.URI.getItemURI(attItem);
              attachmentURIByID.set(ann.parentID, attURI);
            }
          }
          if (attURI) {
            j.attachmentURI = attURI;
          }
        }
      } catch (_) {
        // ignore
      }
      // Select-URI aus citationItem ableiten (für spätere Anzeige)
      try {
        const uris = j.citationItem && Array.isArray(j.citationItem.uris) ? j.citationItem.uris : null;
        if (uris && uris.length) {
          const sel = buildSelectURIFromCitationURI(uris[0]);
          if (sel) {
            selectURIByAnnotation.set(j.id, sel);
          }
        }
      } catch (_) {
        // ignore
      }
      annMap.set(j.id, j);
      jsonAnnotations.push(j);
    } catch (e) {
      logDebug(
        "generateNoteHTMLFromAnnotations: toJSON failed ann.id=" +
          ann.id +
          " err=" +
          (e && e.message ? e.message : e)
      );
      LAST_SERIALIZE_DEBUG.push(
        "toJSON failed ann.id=" +
          ann.id +
          " err=" +
          (e && e.message ? e.message : e)
      );
    }
  }
  LAST_SERIALIZE_DEBUG.push("jsonAnnotations.length=" + jsonAnnotations.length);

  // Bild-Annotationen wie im Original: data:URL -> eingebettetes Attachment
  await importImagesForAnnotations(jsonAnnotations, noteItem, existingImageMap);

  // Serialize über EditorInstanceUtilities (wie Zotero)
  let serialized = { html: "", citationItems: [] };
  try {
    serialized = Zotero.EditorInstanceUtilities.serializeAnnotations(
      jsonAnnotations,
      true // skipEmbeddingItemData wie in createNoteFromAnnotations
    );
    if (serialized.html) {
      serialized.html = wrapImagesWithLinks(serialized.html, annMap, selectURIByAnnotation);
    }
  } catch (eSer) {
    logDebug(
      "generateNoteHTMLFromAnnotations: serializeAnnotations failed: " +
        (eSer && eSer.message ? eSer.message : eSer)
    );
    LAST_SERIALIZE_DEBUG.push(
      "serializeAnnotations failed: " +
        (eSer && eSer.message ? eSer.message : eSer)
    );
  }

  const hasUnderline = jsonAnnotations.some((a) => a.type === "underline");
  const schemaVersion = hasUnderline ? 10 : 9;

  // Kommentar auf neue Zeile nach Citation, falls vorhanden
  if (serialized.html) {
    serialized.html = serialized.html.replace(
      /(<span class="citation"[^>]*>.*?<\/span>)\s+(?!<)/g,
      '$1<br>'
    );
  }

  // Sichtbaren Titel + Marker + serialized HTML
  LAST_SERIALIZE_DEBUG.push(
    "serialized.html length=" + (serialized.html ? serialized.html.length : 0)
  );
  const body =
    lines.join("\n") +
    "\n\n" +
    (serialized.html || "<p><em>Keine serialisierten Annotationen.</em></p>");

  const html = wrapWithCitationContainer(
    body,
    serialized.citationItems || [],
    schemaVersion
  );
  logDebug(
    "generateNoteHTMLFromAnnotations: ENDE, HTML length=" + html.length
  );
  return html;
}

// Umhüllt HTML mit data-citation-items + schema-version (analog Zotero)
function wrapWithCitationContainer(innerHTML, citationItemsMeta, schemaVersion) {
  const schema = schemaVersion || 10; // default >=9; 10 unterstützt underline
  const stored = citationItemsMeta || [];
  const storedEncoded = encodeURIComponent(JSON.stringify(stored));
  return `<div data-citation-items="${storedEncoded}" data-schema-version="${schema}">${innerHTML}</div>`;
}

// Formatiert Datum/Zeit mit zweistelligen Tag/Monat/Stunden/Minuten
function formatDateTimeLocal(d) {
  const pad = (n) => String(n).padStart(2, "0");
  const day = pad(d.getDate());
  const month = pad(d.getMonth() + 1);
  const year = d.getFullYear();
  const hours = pad(d.getHours());
  const mins = pad(d.getMinutes());
  return `${day}.${month}.${year}, ${hours}:${mins}`;
}

/**
 * Sucht bestehende Master-Note (anhand von MASTER_MARKER).
 */
async function findMasterNote(parentItem) {
  logDebug("findMasterNote: START für parent.id=" + parentItem.id);

  try {
    const noteIDs =
      typeof parentItem.getNotes === "function"
        ? parentItem.getNotes()
        : [];

    if (!noteIDs || !noteIDs.length) {
      logDebug("findMasterNote: keine Note-IDs gefunden");
      return null;
    }

    logDebug("findMasterNote: noteIDs length=" + noteIDs.length);

    const notes = await Zotero.Items.getAsync(noteIDs);
    if (!notes || !notes.length) {
      logDebug("findMasterNote: keine Notes geladen");
      return null;
    }

    const masters = [];
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      if (!n || typeof n.getNote !== "function") continue;
      const html = n.getNote() || "";
      if (html.indexOf(MASTER_MARKER) !== -1) {
        masters.push(n);
      }
    }

    logDebug("findMasterNote: masters length=" + masters.length);

    if (!masters.length) return null;

    if (masters.length > 1) {
      logDebug(
        "findMasterNote: WARNUNG – mehrere Master-Notes gefunden (" +
          masters.length +
          "), benutze die erste."
      );
    }

    const chosen = masters[0];
    logDebug("findMasterNote: ENDE, chosen.id=" + chosen.id);
    return chosen;
  } catch (e) {
    logDebug(
      "findMasterNote: Fehler: " + (e && e.message ? e.message : e)
    );
    return null;
  }
}

/**
 * Popup am Ende anzeigen.
 */
function showResultPopup(results) {
  let message;
  if (!results || !results.length) {
    message =
      "Es wurden keine gültigen Parent-Items verarbeitet.\n\n" +
      "Prüfe bitte:\n" +
      "– dass ein bzw. mehrere Literatur-Einträge (keine Attachments/Notizen) markiert sind,\n" +
      "– dass zu diesen Einträgen annotierte PDFs als Attachments existieren.";
  } else {
    const lines = results.map(r =>
      r.action.toUpperCase() +
      ": " +
      r.noteTitle +
      "  (unter: \"" +
      r.parentTitle +
      "\")"
    );
    message =
      "Master-Notizen erstellt/aktualisiert:\n\n" +
      lines.join("\n") +
      "\n\n" +
      "Du findest die Notizen jeweils als Kind-Notiz unter den genannten Einträgen\n" +
      "in der Hauptliste von Zotero.";
  }

  try {
    const win = Zotero.getMainWindow ? Zotero.getMainWindow() : window;
    if (win && typeof win.alert === "function") {
      win.alert("Master-Annotations-Note", message);
    } else if (typeof alert !== "undefined") {
      alert(message);
    } else {
      Zotero.debug(LOG_PREFIX + "Popup: " + message);
    }
  } catch (e) {
    Zotero.debug(LOG_PREFIX + "Popup-Fehler: " + (e && e.message ? e.message : e));
  }
}

/**
 * Verarbeitet EIN Parent-Item:
 * - Falls noch keine Master-Note → neu anlegen
 * - Falls vorhanden → Inhalt komplett ersetzen
 */
async function processSingleParentItem(parentItem) {
  logDebug(
    "processSingleParentItem: START für item.id=" + (parentItem && parentItem.id)
  );

  if (!parentItem) {
    logDebug("processSingleParentItem: parentItem ist null/undefined → skip");
    return;
  }

  if (
    typeof parentItem.isRegularItem !== "function" ||
    !parentItem.isRegularItem()
  ) {
    logDebug(
      "processSingleParentItem: Item " +
        parentItem.id +
        " ist kein reguläres Top-Level-Item → skip"
    );
    return;
  }

  if (typeof parentItem.isNote === "function" && parentItem.isNote()) {
    logDebug(
      "processSingleParentItem: Item " + parentItem.id + " ist eine Note → skip"
    );
    return;
  }

  const parentTitle = parentItem.getField
    ? parentItem.getField("title") || "(ohne Titel)"
    : "(ohne Titel)";
  const title = buildNoteTitle(parentItem);
  const existingMaster = await findMasterNote(parentItem);

  // Falls vorhanden: vorhandene Image-Mappings aus dem bestehenden Inhalt lesen
  const existingImageMap = new Map();
  if (existingMaster) {
    try {
      const html = existingMaster.getNote() || "";
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      doc.querySelectorAll("img[data-attachment-key]").forEach((img) => {
        const annEncoded = img.getAttribute("data-annotation");
        const key = img.getAttribute("data-attachment-key");
        if (!annEncoded || !key) return;
        try {
          const annObj = JSON.parse(decodeURIComponent(annEncoded));
          const annKey = annObj.annotationKey || annObj.id;
          if (annKey) {
            existingImageMap.set(annKey, key);
          }
        } catch (_) {
          // ignore parse errors
        }
      });
    } catch (e) {
      logDebug("processSingleParentItem: parse existing note failed: " + (e && e.message ? e.message : e));
    }
  }

  let noteItem = existingMaster;
  let action = "updated";
  if (!noteItem) {
    // Note zuerst speichern, damit sie als Parent für eingebettete Bilder dient
    noteItem = new Zotero.Item("note");
    noteItem.parentID = parentItem.id;
    noteItem.libraryID = parentItem.libraryID;
    noteItem.setNote(""); // Platzhalter
    await noteItem.saveTx();
    action = "created";
  }

  const noteHTML = await generateNoteHTMLFromAnnotations(parentItem, noteItem, title, existingImageMap);

  noteItem.setNote(noteHTML);
  await noteItem.saveTx();
  logDebug(
    "processSingleParentItem: Master-Note " +
      (action === "created" ? "NEU" : "AKTUALISIERT") +
      ", note.id=" +
      noteItem.id
  );
  RESULTS.push({
    action,
    parentTitle,
    noteTitle: title
  });

  logDebug("processSingleParentItem: ENDE für item.id=" + parentItem.id);
}

/**
 * HAUPTLOGIK FÜR ACTIONS & TAGS
 *
 * - A&T triggert beim Item-Menü/Shortcut zuerst einmal mit `items=[...]` und `item=undefined`,
 *   danach ggf. noch einmal pro Item mit `item=...` und `items=[]`.
 * - Wir wollen nur den ERSTEN Aufruf verwenden → wenn `item` gesetzt ist, direkt return.
 * - Es werden nur reguläre Parent-Items verarbeitet (Attachments/Notes → auf Parent hochlaufen).
 */

(async () => {
  // Per-Item-Aufrufe überspringen
  if (typeof item !== "undefined" && item && (!items || !items.length)) {
    logDebug(
      "TOP-LEVEL: Per-Item-Aufruf erkannt (item.id=" + item.id + ") → skip"
    );
    return;
  }

  if (!items || !items.length) {
    logDebug("TOP-LEVEL: Keine items[] übergeben → Abbruch");
    showResultPopup([]);
    return;
  }

  logDebug(
    "TOP-LEVEL: Start mit items.length=" +
      items.length +
      ", triggerType=" +
      (typeof triggerType === "undefined" ? "unknown" : triggerType)
  );

  const parents = [];
  const seenParentIDs = new Set();

  for (let i = 0; i < items.length; i++) {
    let it = items[i];
    if (!it) continue;

    let parent = it;

    // Child (Attachment, Note, Annotation) → zum Top-Level-Parent hoch
    if (
      typeof it.isRegularItem === "function" &&
      !it.isRegularItem()
    ) {
      if (it.parentItem) {
        parent = it.parentItem;
        logDebug(
          "TOP-LEVEL: Item[" +
            i +
            "] id=" +
            it.id +
            " ist Child → parentItem.id=" +
            parent.id
        );
      } else if (typeof it.getSource === "function") {
        parent = it.getSource();
        logDebug(
          "TOP-LEVEL: Item[" +
            i +
            "] id=" +
            it.id +
            " getSource() → parent.id=" +
            (parent && parent.id)
        );
      }
    }

    if (
      !parent ||
      typeof parent.isRegularItem !== "function" ||
      !parent.isRegularItem()
    ) {
      logDebug(
        "TOP-LEVEL: Item[" +
          i +
          "] (id=" +
          it.id +
          ") hat keinen regulären Parent → skip"
      );
      continue;
    }

    if (seenParentIDs.has(parent.id)) {
      logDebug(
        "TOP-LEVEL: Parent id=" + parent.id + " bereits in Liste → skip"
      );
      continue;
    }

    seenParentIDs.add(parent.id);
    parents.push(parent);
  }

  if (!parents.length) {
    logDebug("TOP-LEVEL: Keine gültigen Parent-Items gefunden → Abbruch");
    showResultPopup([]);
    return;
  }

  for (let p of parents) {
    await processSingleParentItem(p);
  }

  logDebug("TOP-LEVEL: Fertig, parents.length=" + parents.length);
  showResultPopup(RESULTS);
})();
