/**
 * @file Store Version Info in PDF Attachment Titles
 * @author cerenkov
 * @version 0.1
 * @usage Select multiple items then trigger in the context menu
 * @see https://github.com/crnkv/Zotero-Action-Scripts-Collection
 * suggested Menu Label: Store Version Info in PDF Attachment Titles (Multiple)
 * @todo add progress bar
 */

const Zotero = require("Zotero");
const SCRIPTNAME = "Set Attachment Titles";
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

// Function to process setting of each attachment
async function processSetting(attachment) {
    if (!attachment.isPDFAttachment()) {
        // Skip non-PDF attachments, e.g. webpage snapshots (implicitly skips weblinks Zotero.Attachments.LINK_MODE_LINKED_URL)
        return { set: 0, errors: 0 };
    }

    if (attachment.attachmentLinkMode === Zotero.Attachments.LINK_MODE_LINKED_URL) {
        // no extra considerations
    }

    if (!attachment.parentItemID) {
        error(`Attachment ${attachment.id} does not have a parent item.`);
        return { set: 0, errors: 1 };
    }

    const parentItem = await Zotero.Items.getAsync(attachment.parentItemID);
    if (!parentItem) {
        error(`No parent item found for attachment ${attachment.id}.`);
        return { set: 0, errors: 1 };
    }
    const parentTitle = parentItem.getField('title');

    let title = attachment.getField("title");
    if (title.match(excludeRegEx) {
        // Skip supplemental material
        return { set: 0, errors: 0 };
    }

    let version = null;
    if (/published/i.test(title)) {
        version = PUBLISHED;
    } else if (/accepted/i.test(title)) {
        version = ACCEPTED;
    } else if (/submitted|preprint/i.test(title)) {
        version = PREPRINT;
    }

    let hint = null;
    const url = attachment.getField("url");
    if (url) {
        if (/:\/\/([^\/]+\.)?(arxiv\.org|xxx\.lanl\.gov)/i.test(url)) {
            hint = "arXiv";
        } else if (/:\/\/([^\/]+\.)?sci-hub/i.test(url)) {
            hint = "Sci-Hub";
        } else if (/:\/\/([^\/]+\.)?(iop\.org|aps\.org|springer\.com|sciencedirect(assets)?\.com|nature\.com|scipost\.org|sissa\.it|aip\.org|projecteuclid\.org|adsabs\.harvard\.edu)/i.test(url)) {
            hint = /:\/\/([^\/]+\.)?([^\.\/]+)\.([^\.\/]+)\//i.exec(url)[2].toLowerCase();
            hint = new Map([["iop", "IOP"], ["aps", "APS"], ["springer", "Springer"], ["sciencedirect", "ScienceDirect"], ["sciencedirectassets", "ScienceDirect"], ["nature", "Nature"], ["scipost", "SciPost"], ["sissa", "SISSA"], ["aip", "AIP"], ["projecteuclid", "ProjectEuclid"], ["harvard", "ADS"]]).get(hint);
            if (hint == "ADS" && /eprint|arxiv/i.test(url)) hint = "arXiv";
        }
    }
    if (!hint && new RegExp(`(${PUBLISHED}|${ACCEPTED}|${PREPRINT}) \\((.+)\\)`).test(title)) {
        hint = new RegExp(`(${PUBLISHED}|${ACCEPTED}|${PREPRINT}) \\(([^\\)]+)\\)`).exec(title)[2];
    }

    const doi = parentItem.getField('DOI') || parentItem.getExtraField('DOI');
    if (hint == "arXiv") {
        if (version == PUBLISHED) {
            warn(`needs double check: ${PUBLISHED} (arXiv)\n${parentTitle}`);
        } else if (!version) {
            version = PREPRINT;
        }
    } else if (hint == "Sci-Hub") {
        if (version && version !== PUBLISHED) {
            warn(`needs double check: ${version} (Sci-Hub)\n${parentTitle}`);
        } else if (!version) {
            version = PUBLISHED;
        }
    } else if (hint) {
        if (/:\/\/([^\.]+\.)?aps\.org\/accepted/i.test(url)) {
            if (version && version !== ACCEPTED) {
                warn(`deduce: ${version} => ${ACCEPTED} (APS)\n${parentTitle}`);
            }
            version = ACCEPTED;
        } else {
            if (version && version !== PUBLISHED) {
                warn(`needs double check: ${version} (${hint})\n${parentTitle}`);
            } else if (!version) {
                version = PUBLISHED;
            }
        }
    } else { // hint === null
        if (version) {
            // OA decided submitted/accepted/published
        } else if (!url) { // no version, try to match with OA, need url and doi first
            warn(`no URL\n${parentTitle}`);
            version = "Unknown";
        } else if (!doi) {
            warn(`no DOI\n${parentTitle}`);
            version = "Unknown";
        } else {
            // inspirehep-/OA-directed univ url, become Full Text
            const req = await Zotero.HTTP.request('POST', 'https://services.zotero.org/oa/search', {headers: {'Content-Type': 'application/json'}, body: JSON.stringify({"doi": doi, timeout: 5000}), responseType: 'json'});
            const resolvers = req.response;
            if (resolvers.length == 0) {
                warn(`no OA info\n${parentTitle}`);
                version = "Unknown";
            } else {
                const res = resolvers.filter(r => (r.url == url));
                if (res.length == 0) {
                    // probably inspirehep origin univ-url
                    warn(`no exact-matched OA info\n${parentTitle}`);
                    log(resolvers);
                    version = "Unknown";
                } else {
                    // OA origin confirmed
                    res = res[0];
                    if (/published/i.test(res.version)) {
                        version = PUBLISHED;
                    } else if (/accepted/i.test(res.version)) {
                        version = ACCEPTED;
                    } else if (/submitted/i.test(res.version)) {
                        version = PREPRINT;
                    } else {
                        warn(`unknown OA version: ${res.version}\n${parentTitle}`);
                        version = `Unknown (${res.version})`;
                    }
                }
            }
        }
    }

    if (hint) {
        title = `${version} (${hint})`;
    } else {
        title = version;
    }

    attachment.setField("title", title);
    await attachment.saveTx();
    return { set: 1, errors: 0 };
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
    let totalSet = 0;
    let totalErrors = 0;
    for (const attachment of attachments) {
        const result = await processSetting(attachment);
        totalSet += result.set;
        totalErrors += result.errors;
    }

    // Display a summary alert only if there are significant outcomes to report
    if (totalSet > 0 || totalErrors > 0) {
        alert(`Successfully set ${totalSet} attachment titles. Errors: ${totalErrors}`);
    }
})();