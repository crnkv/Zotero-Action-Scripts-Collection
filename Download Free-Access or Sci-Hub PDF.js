/**
 * @file Download Free-Access or Sci-Hub PDF
 * @author cerenkov
 * @version 0.1
 * @requires set up extensions.zotero.findPDFs.resolvers in the Advanced Config Editor, or via the Sci-PDF plugin
 * @usage Select multiple items then trigger in the context menu
 * @see https://github.com/crnkv/Zotero-Action-Scripts-Collection
 * suggested Menu Label: Download Free-Access or Sci-Hub PDF (Multiple)
 */

const Zotero = require("Zotero");
const SCRIPTNAME = "Download PDF";

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

// Function to process downloading of each parent item
async function processDownloading(item) {
    if (!item.isRegularItem()) {
        // Skip not-regular (Note/Attachment/Annotation) items
        return { downloaded: 0, errors: 0 };
    }

    if (item.itemType == "webpage" || item.itemType == "book") {
        // Skip webpage items and book items
        return { downloaded: 0, errors: 0 };
    }

    if (Zotero.Items.get(item.getAttachments())
        .some(
            i => i.isPDFAttachment() 
            && (i.getField("url").match(/sci-hub/i) 
                || i.getField("title").match(/sci-hub/i) 
                || i.getField("title").match(/published/i))
        )) {
        // Skip items that already have Sci-Hub PDF or Published Version PDF
        return { downloaded: 0, errors: 0 };
    }

    const itemTitle = item.getField("title");
    if (!item.getField('DOI') && !item.getExtraField('DOI')) {
        error(`no DOI: ${itemTitle}`);
        popup(`no DOI: ${itemTitle}`);
        return { downloaded: 0, errors: 1 };
    } else if ((item.getField('DOI') || item.getExtraField('DOI')).match(/arxiv/i)) {
        if (item.itemType == "preprint" || item.itemType == "conferencePaper") {
            // silently skip Preprints and ConferencePapers that reasonably don't have non-arXiv DOI
            warn(`DOI is arXiv for Preprint or PonferencePaper: ${itemTitle}`);
            return { downloaded: 0, errors: 0 };
        } else {
            error(`DOI is arXiv: ${itemTitle}`);
            popup(`DOI is arXiv: ${itemTitle}`);
            return { downloaded: 0, errors: 1 };
        }
    }

    let resolvers = Zotero.Attachments.getFileResolvers(item, 'doi');
    let attachment = await Zotero.Attachments.addFileFromURLs(item, resolvers);
    if (attachment) {
        attachment.setField('title', 'Published Version');
        await attachment.saveTx();
        return { downloaded: 1, errors: 0 };
    }

    // TODO: distinguish network error from sci-hub-resolved file-not-found
    resolvers = Zotero.Attachments.getFileResolvers(item, 'custom');
    attachment = await Zotero.Attachments.addFileFromURLs(item, resolvers, {onRequestError: function (e) { error(`Network error when downloading (${e.status}): ${itemTitle}`); return false; }});
    if (attachment) {
        attachment.setField('title', 'Published Version (Sci-Hub)');
        await attachment.saveTx();
        return { downloaded: 1, errors: 0 };
    }

    error(`Download failed (no file, or network errors on download or on resolver): ${itemTitle}`);
    popup(`Download failed: ${itemTitle}`);
    return { downloaded: 0, errors: 1 };
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
    let totalItems = targetItems.length;
    let totalDownloaded = 0;
    let totalErrors = 0;
    let totalSkipped = 0;
    const pw = new Zotero.ProgressWindow();
    pw.changeHeadline(SCRIPTNAME);
    let itemProgress = new pw.ItemProgress(null, `Checking all ${totalItems} items.`);
    itemProgress.setProgress((totalDownloaded+totalErrors+totalSkipped)/totalItems*100);
    pw.show();
    for (const item of targetItems) {
        const result = await processDownloading(item);
        totalDownloaded += result.downloaded;
        totalErrors += result.errors;
        totalSkipped += 1 - result.downloaded - result.errors;
        itemProgress.setText(`${totalDownloaded} succeeded, ${totalErrors} failed and ${totalSkipped} skipped in all ${totalItems} items.`);
        itemProgress.setProgress((totalDownloaded+totalErrors+totalSkipped)/totalItems*100);
    }

    // Display a summary alert only if there are significant outcomes to report
    if (totalDownloaded > 0 || totalErrors > 0) {
        alert(`Successfully downloaded ${totalDownloaded} attachments. Errors: ${totalErrors}`);
    }
})();