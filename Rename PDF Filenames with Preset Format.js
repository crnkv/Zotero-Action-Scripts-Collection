/**
 * @file Rename PDF Filenames with Preset Format
 * @author thalient-ai, cerenkov
 * @version 0.1
 * @requires set up the 'Customize Filename Format' in the General Settings
 * @usage Select multiple items then trigger in the context menu
 * @see https://github.com/crnkv/Zotero-Action-Scripts-Collection
 * @see https://github.com/windingwind/zotero-actions-tags/discussions/380
 * suggested Menu Label: Rename PDF Filenames with Preset Format (Multiple)
 * @todo add progress bar
 */

const Zotero = require("Zotero");
const SCRIPTNAME = "Rename PDF Filenames";
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

// Function to process renaming of each attachment
async function processRenaming(attachment) {
    if (!attachment.isPDFAttachment()) {
        // Skip non-PDF attachments, e.g. webpage snapshots (implicitly skips weblinks Zotero.Attachments.LINK_MODE_LINKED_URL)
        return { renamed: 0, errors: 0 };
    }

    if (attachment.attachmentLinkMode === Zotero.Attachments.LINK_MODE_LINKED_URL) {
        error(`Cannot rename linked URL attachment ${attachment.id}.`);
        return { renamed: 0, errors: 1 };
    }

    if (!attachment.parentItemID) {
        error(`Attachment ${attachment.id} does not have a parent item.`);
        return { renamed: 0, errors: 1 };
    }

    const parentItem = await Zotero.Items.getAsync(attachment.parentItemID);
    if (!parentItem) {
        error(`No parent item found for attachment ${attachment.id}.`);
        return { renamed: 0, errors: 1 };
    }

    const currentPath = await attachment.getFilePathAsync();
    if (!currentPath) {
        error(`No local file path available for attachment ${attachment.id}.`);
        return { renamed: 0, errors: 1 };
    }

    if (attachment.getField("title").match(excludeRegEx)) {
        // Skip supplemental material
        return { renamed: 0, errors: 0 };
    }

    const newName = Zotero.Attachments.getFileBaseNameFromItem(parentItem, {attachmentTitle: attachment.getField("title")}); // when the preset format needs the attachmentTitle variable
    const currentName = currentPath.split(/(\\|\/)/g).pop();
    const extension = currentName.includes('.') ? currentName.split('.').pop() : '';
    const finalName = extension ? `${newName}.${extension}` : newName;

    if (newName !== currentName) {
        try {
            await attachment.renameAttachmentFile(finalName);
            return { renamed: 1, errors: 0 };
        } catch (e) {
            error(`Error renaming attachment ${attachment.id}: ${e}`);
            return { renamed: 0, errors: 1 };
        }
    }

    return { renamed: 0, errors: 0 };
}
function prepareAttachmentItemsList() {
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
        let attachments = [];
        for (const item of items) {
            if (item.itemType === 'attachment') {
                if (!attachments.includes(item)) attachments.push(item);
            } else {
                for (const it of Zotero.Items.get(item.getAttachments())) {
                    if (!attachments.includes(it)) attachments.push(it);
                }
            }
        }
        return attachments;
    } else {
        return false;
    }
}

// Main execution block
(async () => {
    let attachments = prepareAttachmentItemsList();
    if (!attachments) {
        return;
    }
    let totalRenamed = 0;
    let totalErrors = 0;
    for (const attachment of attachments) {
        const result = await processRenaming(attachment);
        totalRenamed += result.renamed;
        totalErrors += result.errors;
    }

    // Display a summary alert only if there are significant outcomes to report
    if (totalRenamed > 0 || totalErrors > 0) {
        alert(`Successfully renamed ${totalRenamed} PDF filenames. Errors: ${totalErrors}`);
    }
})();