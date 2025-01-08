/**
 * Set Published Version as Default PDF
 * @author cerenkov
 * @version 0.1
 * @usage Select multiple items then trigger in context menu
 * @link https://github.com/crnkv/Zotero-Action-Scripts-Collection
 * @menu Set Published Version as Default PDF (Multiple)
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
async function processItem(item) {
    if ((await item.getBestAttachment()).getField("title").match(/published/i)) {
        return;
    }

    let attachments = Zotero.Items.get(item.getAttachments());
    attachments = attachments.filter(a => a.attachmentContentType == 'application/pdf');
    let published = attachments.filter(a => a.getField("title").match(/published/i));
    if (published.length == 0) {
        return;
    }

    let earliestDate = getEarliestDate(attachments);
    earliestDate.setSeconds(earliestDate.getSeconds() - 1);

    const dateString = earliestDate.toISOString().slice(0,19).replace('T', ' ');
    published[0].setField('dateAdded', dateString);
    await published[0].saveTx({ skipDateModifiedUpdate: true });
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

    for (const item of targetItems) {
        await processItem(item);
    }
})();