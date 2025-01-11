/**
 * @file DeDuplicate PDF Attachments
 * @author cerenkov
 * @version 0.1
 * @usage Select multiple items then trigger in the context menu
 * @description Warning: When the script is run on a well-maintained library with 
 * your annotations in PDFs, use the 'earliest' version of the getBest() function, 
 * which will preserve the earliest PDF with your annotations, but you'll need to 
 * manually remove/deduplicate earlier version PDFs when you want to keep a later-
 * downloaded updated version (e.g. arXiv v2). When the script is run on a messy 
 * library with lots of PDF versions and no annotations to preserve, use the 'latest' 
 * version of the getBest() function, which will save your time from manually keeping 
 * only the updated version.
 * @see https://github.com/crnkv/Zotero-Action-Scripts-Collection
 * suggested Menu Label: DeDuplicate PDF Attachments (Multiple)
 * @todo add progress bar
 */

const Zotero = require("Zotero");
const SCRIPTNAME = "DeDuplicate PDF Attachments";
const PUBLISHED = "Published Version";
const ACCEPTED = "Accepted Version";
const PREPRINT = "Preprint";
const excludeRegEx = /supplement/i;

function popup(msg, timeout = null) {
    const pw = new Zotero.ProgressWindow();
    pw.changeHeadline(SCRIPTNAME);
    pw.addDescription(msg);
    pw.show();
    if (timeout) pw.startCloseTimer(timeout * 1000);
}
function log(msg) {
    if (typeof msg == "object") {
        Zotero.log(JSON.stringify(msg), "info");
    } else {
        Zotero.log(msg, "info");
    }
}
function alert(msg) {
    Zotero.alert(null, SCRIPTNAME, `[${SCRIPTNAME}] ${msg}`);
}
function warn(msg) {
    Zotero.warn(`[${SCRIPTNAME}] ${msg}`);
}
function error(msg) {
    Zotero.logError(`[${SCRIPTNAME}] ${msg}`);
}

function getDups(cur, baseLst) {
    let id = cur.id;
    let fileSize = Zotero.File.pathToFile(cur.getFilePath()).fileSize;
    let url = cur.getField("url").toLowerCase();
    let dups = [];
    for (let att of baseLst) {
        if (att.id !== id 
            && (Zotero.File.pathToFile(att.getFilePath()).fileSize == fileSize
                || att.getField("url").toLowerCase().includes(url) 
                || url.includes(att.getField("url").toLowerCase())) ) {
            dups.push(att);
        }
    }
    let secDups = [];
    let dupIds = dups.map(d => d.id);
    let secBaseLst = baseLst.filter(a => (a.id !== id && !dupIds.includes(a.id)));
    for (let att of dups) {
        secDups = secDups.concat(getDups(att, secBaseLst));
    }
    dups.push(cur);
    dups = dups.concat(secDups);
    return [...new Set(dups)];
}
function getBest(dups) {
    let earliest = null;
    for (let att of dups) {
        if (!earliest || Zotero.File.pathToFile(att.getFilePath()).lastModifiedTime > Zotero.File.pathToFile(earliest.getFilePath()).lastModifiedTime) {
            earliest = att;
        }
    }
    return {best: earliest, dups: dups.filter(a => a.id !== earliest.id)};
}
// function getBest(dups) {
//     let latest = null;
//     for (let att of dups) {
//         if (!latest || Zotero.File.pathToFile(att.getFilePath()).lastModifiedTime > Zotero.File.pathToFile(latest.getFilePath()).lastModifiedTime) {
//             latest = att;
//         }
//     }
//     return {best: latest, dups: dups.filter(a => a.id !== latest.id)};
// }

async function processRemoving(item) {
    let removed = 0;
    let errors = 0;

    if (!item.isRegularItem()) {
        // Skip not-regular (Note/Attachment/Annotation) items
        return { removed: 0, errors: 0 };
    }

    if (item.itemType == "webpage") {
        // Skip webpage items
        return { removed: 0, errors: 0 };
    }

    const attachments = Zotero.Items.get(item.getAttachments()).filter(i => i.isPDFAttachment());
    if (attachments.length < 2) {
        // no duplicates
        return { removed: 0, errors: 0 };
    }

    let versioned = [];
    let notVersioned = [];
    let toRemove = [];
    for (let att of attachments) {
        if (att.getField("title").match(/preprint|accepted version|published version/i)) {
            versioned.push(att);
        } else {
            notVersioned.push(att);
        }
    }

    for (let att of notVersioned) {
        // prioritize versioned attachments
        let fileSize = Zotero.File.pathToFile(att.getFilePath()).fileSize;
        let url = att.getField("url").toLowerCase();
        if (versioned.some(a => Zotero.File.pathToFile(a.getFilePath()).fileSize == fileSize)) {
            toRemove.push(att);
        } else if (!att.getField("title").match(excludeRegEx) 
            && url !== "" 
            && versioned.some(a => { let u = a.getField("url").toLowerCase(); return u !== "" && (u.includes(url) || url.includes(u)); })) {
            toRemove.push(att);
        }
    }

    let baseLst = versioned.filter(a => a.getField("title").match(/published version/i));
    if (baseLst.some(a => !a.getField("title").match(/sci-hub/i))) {
        // has non-Sci-Hub sourced PDF
        // remove all Sci-Hub PDF, leaving non-Sci-Hub sourced only
        toRemove = toRemove.concat(baseLst.filter(a => a.getField("title").match(/sci-hub/i)));
        baseLst = baseLst.filter(a => !a.getField("title").match(/sci-hub/i));
        let left = [];
        for (let att of baseLst) {
            if (!toRemove.map(a => a.id).includes(att.id) && !left.map(a => a.id).includes(att.id)) {
                let { best, dups } = getBest(getDups(att, baseLst));
                left.push(best);
                toRemove = toRemove.concat(dups);
            }
        }
    } else {
        // wholy Sci-Hub PDF
        let { best, dups } = getBest(baseLst);
        toRemove = toRemove.concat(dups);
    }

    baseLst = versioned.filter(a => a.getField("title").match(/accepted version/i));
    left = [];
    for (let att of baseLst) {
        if (!toRemove.map(a => a.id).includes(att.id) && !left.map(a => a.id).includes(att.id)) {
            let { best, dups } = getBest(getDups(att, baseLst));
            left.push(best);
            toRemove = toRemove.concat(dups);
        }
    }

    baseLst = versioned.filter(a => a.getField("title").match(/preprint/i));
    left = [];
    for (let att of baseLst) {
        if (!toRemove.map(a => a.id).includes(att.id) && !left.map(a => a.id).includes(att.id)) {
            let { best, dups } = getBest(getDups(att, baseLst));
            left.push(best);
            toRemove = toRemove.concat(dups);
        }
    }

    for (let att of toRemove) {
        try {
            await Zotero.Items.trashTx(att.id);
            removed += 1;
        } catch(e) {
            error(`Failed to remove attachment ${att.id} (${att.getField("title")}) of ${item.getField("title")}`);
            errors += 1;
        }
    }
    return { removed: removed, errors: errors };
}
function prepareTopLevelItemsList() {
    if (!items && !item) {
        alert("No item or items array provided.");
        return false;
    }
    if (item) {
        // reject script calls with items=[], item=...
        return false;
    }
    if (items?.length > 0) {
        // accept script calls with items=[...], item=undefined
        return Zotero.Items.getTopLevel(items);
    } else {
        return false;
    }
}

// Main execution block
(async () => {
    let targetItems = prepareTopLevelItemsList();
    if (!targetItems) {
        return;
    }
    let totalRemoved = 0;
    let totalErrors = 0;
    for (const item of targetItems) {
        const result = await processRemoving(item);
        totalRemoved += result.removed;
        totalErrors += result.errors;
    }

    if (totalRemoved > 0 || totalErrors > 0) {
        alert(`Successfully removed ${totalRemoved} attachments. Errors: ${totalErrors}`);
    }
})();