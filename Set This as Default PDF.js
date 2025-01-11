/**
 * @file Set This as Default PDF
 * @author cerenkov
 * @version 0.1
 * @usage Select one single PDF item then trigger in the context menu
 * @see https://github.com/crnkv/Zotero-Action-Scripts-Collection
 * suggested Menu Label: Set This as Default PDF
 */

const Zotero = require("Zotero");
const SCRIPTNAME = "Set Default PDF";

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

function getEarliestDate(attachments) {
    let earliestDate = new Date();
    for (const att of attachments) {
        const date = new Date(att.dateAdded+"Z"); // Zulu
        if (date < earliestDate) {
            earliestDate = date;
        }
    }
    return earliestDate;
}
async function setDefault(item) {
    let attachments = Zotero.Items.get(item.parentItem.getAttachments());
    attachments = attachments.filter(a => a.attachmentContentType == 'application/pdf');

    let earliestDate = getEarliestDate(attachments);
    earliestDate.setSeconds(earliestDate.getSeconds() - 1);

    const dateString = earliestDate.toISOString().slice(0,19).replace('T', ' ');
    item.setField('dateAdded', dateString);
    await item.saveTx({ skipDateModifiedUpdate: true });
}

// Main execution block
(async () => {
    if (!items && !item) {
        alert("No item or items array provided.");
        return;
    }
    if (!item) {
        // reject script calls with items=[...], item=undefined
        return;
    }
    if (!item.isPDFAttachment()) {
        return;
    }

    await setDefault(item);
})();