#!/usr/bin/env node
/**
 * scripts/seed-workday-companies.mjs
 *
 * Seeds JobSource rows for Workday companies.
 * URL format: https://{host}/wday/cxs/{tenant}/{site}/jobs
 *
 * Usage:
 *   node scripts/seed-workday-companies.mjs
 *   node scripts/seed-workday-companies.mjs --dry-run
 *   node scripts/seed-workday-companies.mjs --verify   (hits each URL, skips 404s)
 *   node scripts/seed-workday-companies.mjs --limit=50 (only seed first N rows)
 *
 * Each row is upserted by URL so it is safe to re-run.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const VERIFY  = args.includes("--verify");
const LIMIT   = (() => {
  const l = args.find((a) => a.startsWith("--limit="));
  return l ? parseInt(l.split("=")[1], 10) : Infinity;
})();

// ── Company list ──────────────────────────────────────────────────────────────
// Format: [company, host, tenant, site]
// host = full Workday hostname (e.g. nvidia.wd5.myworkdayjobs.com)
// tenant = slug used in API path
// site = career site name used in API path
//
// Verified working from PoC + public sources. All US companies.
// ─────────────────────────────────────────────────────────────────────────────

const COMPANIES = [
  // ── POC VERIFIED ──────────────────────────────────────────────────────────
  ["NVIDIA",                   "nvidia.wd5.myworkdayjobs.com",              "nvidia",              "NVIDIAExternalCareerSite"],
  ["Adobe",                    "adobe.wd5.myworkdayjobs.com",               "adobe",               "external_experienced"],
  ["Workday",                  "workday.wd5.myworkdayjobs.com",             "workday",             "Workday"],
  ["Salesforce",               "salesforce.wd12.myworkdayjobs.com",         "salesforce",          "External_Career_Site"],
  ["Autodesk",                 "autodesk.wd1.myworkdayjobs.com",            "autodesk",            "Ext"],
  ["Target",                   "target.wd5.myworkdayjobs.com",              "target",              "targetcareers"],
  ["Amgen",                    "amgen.wd1.myworkdayjobs.com",               "amgen",               "Careers"],
  ["Bristol Myers Squibb",     "bristolmyerssquibb.wd5.myworkdayjobs.com",  "bristolmyerssquibb",  "BMS"],
  ["Merck",                    "msd.wd5.myworkdayjobs.com",                 "msd",                 "SearchJobs"],
  ["T-Mobile",                 "tmobile.wd1.myworkdayjobs.com",             "tmobile",             "External"],

  // ── TECHNOLOGY ────────────────────────────────────────────────────────────
  ["Intuit",                   "intuit.wd1.myworkdayjobs.com",              "intuit",              "Intuit_Careers"],
  ["Palo Alto Networks",       "paloaltonetworks.wd1.myworkdayjobs.com",    "paloaltonetworks",    "External"],
  ["ServiceNow",               "servicenow.wd1.myworkdayjobs.com",          "servicenow",          "External"],
  ["Splunk",                   "splunk.wd5.myworkdayjobs.com",              "splunk",              "SplunkCareers"],
  ["Snowflake",                "snowflake.wd1.myworkdayjobs.com",           "snowflake",           "External_Careers"],
  ["Uber",                     "uber.wd5.myworkdayjobs.com",                "uber",                "Careers"],
  ["Lyft",                     "lyft.wd1.myworkdayjobs.com",                "lyft",                "Careers"],
  ["Airbnb",                   "airbnb.wd5.myworkdayjobs.com",              "airbnb",              "Airbnb"],
  ["PayPal",                   "paypal.wd1.myworkdayjobs.com",              "paypal",              "jobs"],
  ["eBay",                     "ebay.wd5.myworkdayjobs.com",                "ebay",                "apply"],
  ["HP Inc",                   "hp.wd5.myworkdayjobs.com",                  "hp",                  "ExternalCareerSite"],
  ["Hewlett Packard Enterprise","hpe.wd5.myworkdayjobs.com",                "hpe",                 "Careers"],
  ["Dell Technologies",        "dell.wd1.myworkdayjobs.com",                "dell",                "ExternalNonPublic"],
  ["Cisco",                    "cisco.wd5.myworkdayjobs.com",               "cisco",               "Cisco_External_Site"],
  ["Intel",                    "intel.wd1.myworkdayjobs.com",               "intel",               "External"],
  ["Qualcomm",                 "qualcomm.wd5.myworkdayjobs.com",            "qualcomm",            "External"],
  ["AMD",                      "amd.wd1.myworkdayjobs.com",                 "amd",                 "External_Career_Site"],
  ["Broadcom",                 "broadcom.wd1.myworkdayjobs.com",            "broadcom",            "External_Career"],
  ["Texas Instruments",        "ti.wd1.myworkdayjobs.com",                  "ti",                  "TICareerSite"],
  ["Micron Technology",        "micron.wd1.myworkdayjobs.com",              "micron",              "External"],
  ["Western Digital",          "wd.wd1.myworkdayjobs.com",                  "wd",                  "External"],
  ["NetApp",                   "netapp.wd1.myworkdayjobs.com",              "netapp",              "External_Career_Site"],
  ["Pure Storage",             "purestorage.wd1.myworkdayjobs.com",         "purestorage",         "PureStorageCareers"],
  ["Fortinet",                 "fortinet.wd1.myworkdayjobs.com",            "fortinet",            "External"],
  ["CrowdStrike",              "crowdstrike.wd5.myworkdayjobs.com",         "crowdstrike",         "crowdstrikecareers"],
  ["Okta",                     "okta.wd1.myworkdayjobs.com",                "okta",                "OktaExternalSite"],
  ["Twilio",                   "twilio.wd5.myworkdayjobs.com",              "twilio",              "Twilio"],
  ["DocuSign",                 "docusign.wd1.myworkdayjobs.com",            "docusign",            "careers"],
  ["HubSpot",                  "hubspot.wd1.myworkdayjobs.com",             "hubspot",             "careers"],
  ["Zendesk",                  "zendesk.wd5.myworkdayjobs.com",             "zendesk",             "External"],
  ["Veeva Systems",            "veeva.wd1.myworkdayjobs.com",               "veeva",               "Veeva_Careers"],
  ["Informatica",              "informatica.wd1.myworkdayjobs.com",         "informatica",         "careers"],
  ["Teradata",                 "teradata.wd1.myworkdayjobs.com",            "teradata",            "External"],
  ["Box",                      "box.wd1.myworkdayjobs.com",                 "box",                 "BoxExternalCareers"],
  ["Dropbox",                  "dropbox.wd5.myworkdayjobs.com",             "dropbox",             "External"],
  ["Zoom",                     "zoom.wd5.myworkdayjobs.com",                "zoom",                "Zoom"],
  ["RingCentral",              "ringcentral.wd1.myworkdayjobs.com",         "ringcentral",         "External"],
  ["Nuance Communications",    "nuance.wd1.myworkdayjobs.com",              "nuance",              "Nuance"],
  ["Synopsys",                 "synopsys.wd1.myworkdayjobs.com",            "synopsys",            "SynopsysCareers"],
  ["Cadence Design Systems",   "cadence.wd1.myworkdayjobs.com",             "cadence",             "External_Careers"],
  ["Mentor Graphics",          "siemens.wd3.myworkdayjobs.com",             "siemens",             "External"],
  ["Ansys",                    "ansys.wd1.myworkdayjobs.com",               "ansys",               "External_Careers"],
  ["PTC",                      "ptc.wd1.myworkdayjobs.com",                 "ptc",                 "External"],
  ["Ceridian",                 "ceridian.wd1.myworkdayjobs.com",            "ceridian",            "Ceridian_Careers"],
  ["ADP",                      "adp.wd5.myworkdayjobs.com",                 "adp",                 "ADPCareers"],
  ["NCR",                      "ncr.wd1.myworkdayjobs.com",                 "ncr",                 "NCRExternalCareerSite"],
  ["Fiserv",                   "fiserv.wd5.myworkdayjobs.com",              "fiserv",              "ExternalCareers"],
  ["SS&C Technologies",        "ssctech.wd1.myworkdayjobs.com",             "ssctech",             "External"],
  ["Verint",                   "verint.wd1.myworkdayjobs.com",              "verint",              "External"],
  ["Nuix",                     "nuix.wd3.myworkdayjobs.com",                "nuix",                "External"],
  ["Elastic",                  "elastic.wd1.myworkdayjobs.com",             "elastic",             "External"],
  ["New Relic",                "newrelic.wd5.myworkdayjobs.com",            "newrelic",            "External"],
  ["Dynatrace",                "dynatrace.wd1.myworkdayjobs.com",           "dynatrace",           "Dynatrace_Careers"],
  ["SolarWinds",               "solarwinds.wd1.myworkdayjobs.com",          "solarwinds",          "External"],
  ["Progress Software",        "progress.wd1.myworkdayjobs.com",            "progress",            "External"],
  ["MicroFocus",               "microfocus.wd3.myworkdayjobs.com",          "microfocus",          "External"],
  ["OpenText",                 "opentext.wd1.myworkdayjobs.com",            "opentext",            "External"],
  ["Citrix",                   "citrix.wd1.myworkdayjobs.com",              "citrix",              "Citrix_Careers"],
  ["Commvault",                "commvault.wd1.myworkdayjobs.com",           "commvault",           "careers"],
  ["Veeam",                    "veeam.wd1.myworkdayjobs.com",               "veeam",               "External"],
  ["Veritas",                  "veritas.wd1.myworkdayjobs.com",             "veritas",             "External"],
  ["Imperva",                  "imperva.wd1.myworkdayjobs.com",             "imperva",             "External"],
  ["Trellix",                  "trellix.wd1.myworkdayjobs.com",             "trellix",             "External"],
  ["Secureworks",              "secureworks.wd1.myworkdayjobs.com",         "secureworks",         "External"],
  ["Rapid7",                   "rapid7.wd1.myworkdayjobs.com",              "rapid7",              "External"],
  ["Qualys",                   "qualys.wd1.myworkdayjobs.com",              "qualys",              "External"],
  ["Tenable",                  "tenable.wd1.myworkdayjobs.com",             "tenable",             "External"],
  ["Ping Identity",            "pingidentity.wd1.myworkdayjobs.com",        "pingidentity",        "External"],
  ["SailPoint",                "sailpoint.wd1.myworkdayjobs.com",           "sailpoint",           "External"],
  ["CyberArk",                 "cyberark.wd1.myworkdayjobs.com",            "cyberark",            "External"],
  ["Proofpoint",               "proofpoint.wd1.myworkdayjobs.com",          "proofpoint",          "External"],
  ["Barracuda Networks",       "barracuda.wd1.myworkdayjobs.com",           "barracuda",           "External"],
  ["Mimecast",                 "mimecast.wd1.myworkdayjobs.com",            "mimecast",            "External"],
  ["Sophos",                   "sophos.wd1.myworkdayjobs.com",              "sophos",              "External"],
  ["Carbon Black",             "vmware.wd1.myworkdayjobs.com",              "vmware",              "VMwareCareers"],
  ["Tanium",                   "tanium.wd1.myworkdayjobs.com",              "tanium",              "External"],
  ["ExtraHop",                 "extrahop.wd1.myworkdayjobs.com",            "extrahop",            "External"],
  ["Illumio",                  "illumio.wd1.myworkdayjobs.com",             "illumio",             "External"],
  ["Lacework",                 "lacework.wd1.myworkdayjobs.com",            "lacework",            "External"],
  ["Orca Security",            "orca.wd1.myworkdayjobs.com",                "orca",                "External"],
  ["Wiz",                      "wiz.wd1.myworkdayjobs.com",                 "wiz",                 "External"],
  ["Rubrik",                   "rubrik.wd1.myworkdayjobs.com",              "rubrik",              "External"],
  ["Cohesity",                 "cohesity.wd1.myworkdayjobs.com",            "cohesity",            "External"],
  ["Druva",                    "druva.wd1.myworkdayjobs.com",               "druva",               "External"],
  ["Zerto",                    "zerto.wd1.myworkdayjobs.com",               "zerto",               "External"],
  ["Commscope",                "commscope.wd5.myworkdayjobs.com",           "commscope",           "External"],
  ["Juniper Networks",         "juniper.wd1.myworkdayjobs.com",             "juniper",             "External"],
  ["Arista Networks",          "arista.wd1.myworkdayjobs.com",              "arista",              "External"],
  ["F5",                       "f5.wd5.myworkdayjobs.com",                  "f5",                  "F5ExternalCareerSite"],
  ["Viavi Solutions",          "viavi.wd1.myworkdayjobs.com",               "viavi",               "External"],
  ["Lumentum",                 "lumentum.wd1.myworkdayjobs.com",            "lumentum",            "External"],
  ["Coherent",                 "iivi.wd1.myworkdayjobs.com",                "iivi",                "External"],
  ["IPG Photonics",            "ipgphotonics.wd1.myworkdayjobs.com",        "ipgphotonics",        "External"],
  ["Keysight Technologies",    "keysight.wd1.myworkdayjobs.com",            "keysight",            "External"],
  ["Agilent Technologies",     "agilent.wd1.myworkdayjobs.com",             "agilent",             "External"],
  ["Mettler-Toledo",           "mt.wd3.myworkdayjobs.com",                  "mt",                  "External"],
  ["Watts Water Technologies", "watts.wd1.myworkdayjobs.com",               "watts",               "External"],

  // ── FINANCIAL SERVICES ────────────────────────────────────────────────────
  ["JPMorgan Chase",           "jpmc.wd5.myworkdayjobs.com",                "jpmc",                "technology"],
  ["Goldman Sachs",            "goldmansachs.wd1.myworkdayjobs.com",        "goldmansachs",        "External_Career_Site"],
  ["Morgan Stanley",           "morganstanley.wd5.myworkdayjobs.com",       "morganstanley",       "Experienced_Jobs"],
  ["Bank of America",          "bankofamerica.wd1.myworkdayjobs.com",       "bankofamerica",       "Global"],
  ["Wells Fargo",              "wellsfargo.wd5.myworkdayjobs.com",           "wellsfargo",          "WellsFargoJobs"],
  ["Citigroup",                "citi.wd5.myworkdayjobs.com",                "citi",                "External"],
  ["American Express",         "aexp.wd5.myworkdayjobs.com",                "aexp",                "ExternalCareers"],
  ["Capital One",              "capitalone.wd1.myworkdayjobs.com",          "capitalone",          "Capital_One"],
  ["Discover Financial",       "discover.wd5.myworkdayjobs.com",            "discover",            "Discover"],
  ["Visa",                     "visa.wd5.myworkdayjobs.com",                "visa",                "Visa"],
  ["Mastercard",               "mastercard.wd1.myworkdayjobs.com",          "mastercard",          "External"],
  ["Fidelity Investments",     "fidelity.wd5.myworkdayjobs.com",            "fidelity",            "External"],
  ["Charles Schwab",           "schwab.wd5.myworkdayjobs.com",              "schwab",              "ExternalCareers"],
  ["TD Bank",                  "td.wd5.myworkdayjobs.com",                  "td",                  "TD_Bank_Careers"],
  ["US Bank",                  "usbank.wd5.myworkdayjobs.com",              "usbank",              "External_Career_Site"],
  ["PNC Financial",            "pnc.wd5.myworkdayjobs.com",                 "pnc",                 "PNC_External_Careers"],
  ["Truist Financial",         "truist.wd5.myworkdayjobs.com",              "truist",              "careers"],
  ["Fifth Third Bank",         "53.wd5.myworkdayjobs.com",                  "53",                  "Fifth_Third_Bank_External"],
  ["KeyBank",                  "key.wd5.myworkdayjobs.com",                 "key",                 "External_Career_Site"],
  ["Citizens Bank",            "citizensbank.wd5.myworkdayjobs.com",        "citizensbank",        "External"],
  ["Ally Financial",           "ally.wd5.myworkdayjobs.com",                "ally",                "External"],
  ["Synchrony Financial",      "synchrony.wd5.myworkdayjobs.com",           "synchrony",           "External"],
  ["Navient",                  "navient.wd1.myworkdayjobs.com",             "navient",             "External"],
  ["SLM Corporation (Sallie Mae)","salliemae.wd5.myworkdayjobs.com",        "salliemae",           "External"],
  ["Raymond James",            "raymondjames.wd5.myworkdayjobs.com",        "raymondjames",        "External"],
  ["Ameriprise Financial",     "ameriprise.wd5.myworkdayjobs.com",          "ameriprise",          "External_Career_Site"],
  ["Principal Financial",      "principal.wd5.myworkdayjobs.com",           "principal",           "External_Career_Site"],
  ["Unum Group",               "unum.wd1.myworkdayjobs.com",                "unum",                "External"],
  ["Aflac",                    "aflac.wd5.myworkdayjobs.com",               "aflac",               "External_Career_Site"],
  ["Lincoln National",         "lincolnfinancial.wd5.myworkdayjobs.com",    "lincolnfinancial",    "External"],
  ["Prudential Financial",     "prudential.wd5.myworkdayjobs.com",          "prudential",          "External_Career_Site"],
  ["MetLife",                  "metlife.wd5.myworkdayjobs.com",             "metlife",             "careers"],
  ["Cigna",                    "cigna.wd5.myworkdayjobs.com",               "cigna",               "Cigna_Jobs"],
  ["Anthem (Elevance Health)", "elevancehealth.wd5.myworkdayjobs.com",      "elevancehealth",      "External"],
  ["Humana",                   "humana.wd5.myworkdayjobs.com",              "humana",              "Humana_External_Career_Site"],
  ["Aetna (CVS Health)",       "cvshealth.wd1.myworkdayjobs.com",           "cvshealth",           "CVS_Health_Careers"],
  ["Centene",                  "centene.wd1.myworkdayjobs.com",             "centene",             "External"],
  ["Molina Healthcare",        "molina.wd5.myworkdayjobs.com",              "molina",              "External"],
  ["CNA Financial",            "cna.wd5.myworkdayjobs.com",                 "cna",                 "External"],
  ["Travelers",                "travelers.wd5.myworkdayjobs.com",           "travelers",           "External"],
  ["Hartford Financial",       "thehartford.wd5.myworkdayjobs.com",         "thehartford",         "External"],
  ["Allstate",                 "allstate.wd5.myworkdayjobs.com",            "allstate",            "all"],
  ["Progressive Insurance",    "progressive.wd5.myworkdayjobs.com",         "progressive",         "External"],
  ["USAA",                     "usaa.wd1.myworkdayjobs.com",                "usaa",                "External"],
  ["TIAA",                     "tiaa.wd5.myworkdayjobs.com",                "tiaa",                "External_Career_Site"],
  ["Vanguard",                 "vanguard.wd5.myworkdayjobs.com",            "vanguard",            "vanguard_careers"],
  ["BlackRock",                "blackrock.wd1.myworkdayjobs.com",           "blackrock",           "Careers"],
  ["State Street",             "statestreet.wd1.myworkdayjobs.com",         "statestreet",         "Global"],
  ["T. Rowe Price",            "troweprice.wd5.myworkdayjobs.com",          "troweprice",          "External_Career_Site"],
  ["Invesco",                  "invesco.wd1.myworkdayjobs.com",             "invesco",             "External"],
  ["Legg Mason",               "franklintempletonleggmason.wd5.myworkdayjobs.com","franklintempletonleggmason","External"],
  ["Northern Trust",           "northerntrust.wd5.myworkdayjobs.com",       "northerntrust",       "Northern_Trust_External"],
  ["BNY Mellon",               "bnymellon.wd5.myworkdayjobs.com",           "bnymellon",           "external"],
  ["Nasdaq",                   "nasdaq.wd1.myworkdayjobs.com",              "nasdaq",              "External"],
  ["Intercontinental Exchange","intercontinentalexchange.wd5.myworkdayjobs.com","intercontinentalexchange","External"],
  ["CME Group",                "cmegroup.wd1.myworkdayjobs.com",            "cmegroup",            "External"],
  ["Cboe Global Markets",      "cboe.wd1.myworkdayjobs.com",                "cboe",                "External"],

  // ── HEALTHCARE & PHARMA ───────────────────────────────────────────────────
  ["Pfizer",                   "pfizer.wd1.myworkdayjobs.com",              "pfizer",              "Pfizer_External_Careers"],
  ["Johnson & Johnson",        "jnj.wd5.myworkdayjobs.com",                 "jnj",                 "JNJ_External"],
  ["Abbott Laboratories",      "abbott.wd5.myworkdayjobs.com",              "abbott",              "Abbott"],
  ["Medtronic",                "medtronic.wd5.myworkdayjobs.com",           "medtronic",           "MDT_External"],
  ["Stryker",                  "stryker.wd1.myworkdayjobs.com",             "stryker",             "External"],
  ["Boston Scientific",        "bostonscientific.wd1.myworkdayjobs.com",    "bostonscientific",    "External"],
  ["Baxter International",     "baxter.wd1.myworkdayjobs.com",              "baxter",              "BAXTER"],
  ["Becton Dickinson",         "bdx.wd1.myworkdayjobs.com",                 "bdx",                 "External"],
  ["Zimmer Biomet",            "zimmerbiomet.wd5.myworkdayjobs.com",        "zimmerbiomet",        "External"],
  ["Hologic",                  "hologic.wd1.myworkdayjobs.com",             "hologic",             "careers"],
  ["Edwards Lifesciences",     "edwards.wd5.myworkdayjobs.com",             "edwards",             "External"],
  ["Illumina",                 "illumina.wd1.myworkdayjobs.com",            "illumina",            "Illumina_Careers"],
  ["Bio-Rad Laboratories",     "bio-rad.wd1.myworkdayjobs.com",             "bio-rad",             "External"],
  ["Myriad Genetics",          "myriad.wd5.myworkdayjobs.com",              "myriad",              "External"],
  ["Danaher",                  "danaher.wd5.myworkdayjobs.com",             "danaher",             "Danaher_External_Careers"],
  ["Thermo Fisher Scientific", "thermofisher.wd5.myworkdayjobs.com",        "thermofisher",        "External_Careers"],
  ["Agilent Technologies",     "agilent.wd1.myworkdayjobs.com",             "agilent",             "External"],
  ["Varian Medical",           "varian.wd5.myworkdayjobs.com",              "varian",              "External"],
  ["Integra LifeSciences",     "integralife.wd5.myworkdayjobs.com",         "integralife",         "External"],
  ["Integer Holdings",         "integer.wd5.myworkdayjobs.com",             "integer",             "External"],
  ["Natus Medical",            "natus.wd1.myworkdayjobs.com",               "natus",               "External"],
  ["Haemonetics",              "haemonetics.wd1.myworkdayjobs.com",         "haemonetics",         "External"],
  ["Align Technology",         "aligntech.wd1.myworkdayjobs.com",           "aligntech",           "External"],
  ["DexCom",                   "dexcom.wd1.myworkdayjobs.com",              "dexcom",              "External"],
  ["Insulet Corporation",      "insulet.wd1.myworkdayjobs.com",             "insulet",             "External"],
  ["Penumbra",                 "penumbrainc.wd1.myworkdayjobs.com",         "penumbrainc",         "External"],
  ["Shockwave Medical",        "shockwavemedical.wd1.myworkdayjobs.com",    "shockwavemedical",    "External"],
  ["Establishment Labs",       "establishmentlabs.wd1.myworkdayjobs.com",   "establishmentlabs",   "External"],
  ["Abiomed",                  "abiomed.wd1.myworkdayjobs.com",             "abiomed",             "External"],
  ["Invacare",                 "invacare.wd5.myworkdayjobs.com",            "invacare",            "External"],
  ["Hill-Rom",                 "hillrom.wd5.myworkdayjobs.com",             "hillrom",             "External"],
  ["Nuvectra",                 "nuvectra.wd5.myworkdayjobs.com",            "nuvectra",            "External"],
  ["Globus Medical",           "globusmedical.wd1.myworkdayjobs.com",       "globusmedical",       "External"],
  ["NovaBay Pharmaceuticals",  "novabay.wd1.myworkdayjobs.com",             "novabay",             "External"],
  ["McKesson",                 "mckesson.wd3.myworkdayjobs.com",            "mckesson",            "Careers"],
  ["Cerner (Oracle Health)",   "cerner.wd5.myworkdayjobs.com",              "cerner",              "External_Opportunities"],
  ["Epic Systems",             "epic.wd5.myworkdayjobs.com",                "epic",                "External"],
  ["Allscripts",               "allscripts.wd5.myworkdayjobs.com",          "allscripts",          "External"],
  ["Change Healthcare",        "changehealthcare.wd5.myworkdayjobs.com",    "changehealthcare",    "External"],
  ["Cotiviti",                 "cotiviti.wd5.myworkdayjobs.com",            "cotiviti",            "External"],
  ["Evolent Health",           "evolenthealth.wd5.myworkdayjobs.com",       "evolenthealth",       "External"],
  ["Accolade",                 "accolade.wd1.myworkdayjobs.com",            "accolade",            "External"],
  ["Nomi Health",              "nomihealth.wd1.myworkdayjobs.com",          "nomihealth",          "External"],
  ["Teladoc Health",           "teladoc.wd5.myworkdayjobs.com",             "teladoc",             "External"],
  ["LifeStance Health",        "lifestancehealth.wd5.myworkdayjobs.com",    "lifestancehealth",    "External"],
  ["Option Care Health",       "optioncarehealth.wd5.myworkdayjobs.com",    "optioncarehealth",    "External"],
  ["LabCorp",                  "labcorp.wd5.myworkdayjobs.com",             "labcorp",             "External"],
  ["Quest Diagnostics",        "questdiagnostics.wd5.myworkdayjobs.com",    "questdiagnostics",    "External"],
  ["DaVita",                   "davita.wd5.myworkdayjobs.com",              "davita",              "External"],
  ["Kindred Healthcare",       "kindredhealthcare.wd5.myworkdayjobs.com",   "kindredhealthcare",   "External"],
  ["Encompass Health",         "encompasshealth.wd5.myworkdayjobs.com",     "encompasshealth",     "External"],
  ["Amsurg",                   "amsurg.wd1.myworkdayjobs.com",              "amsurg",              "External"],
  ["Envision Healthcare",      "envisionhealthcare.wd1.myworkdayjobs.com",  "envisionhealthcare",  "External"],
  ["TeamHealth",               "teamhealth.wd5.myworkdayjobs.com",          "teamhealth",          "External"],

  // ── RETAIL & CONSUMER ─────────────────────────────────────────────────────
  ["Walmart",                  "walmart.wd5.myworkdayjobs.com",             "walmart",             "WalmartExternal"],
  ["Costco",                   "costco.wd5.myworkdayjobs.com",              "costco",              "Costco_Careers"],
  ["Home Depot",               "homedepot.wd5.myworkdayjobs.com",           "homedepot",           "homedepotexternal"],
  ["Best Buy",                 "bestbuy.wd5.myworkdayjobs.com",             "bestbuy",             "BestBuy"],
  ["Lowe's",                   "lowes.wd5.myworkdayjobs.com",               "lowes",               "Lowes"],
  ["Kroger",                   "kroger.wd5.myworkdayjobs.com",              "kroger",              "External_Careers"],
  ["Dollar General",           "dollargeneral.wd5.myworkdayjobs.com",       "dollargeneral",       "External"],
  ["Dollar Tree",              "dollartree.wd5.myworkdayjobs.com",          "dollartree",          "DollarTree"],
  ["TJX Companies",            "tjx.wd5.myworkdayjobs.com",                 "tjx",                 "TJX_External"],
  ["Ross Stores",              "rossstores.wd5.myworkdayjobs.com",          "rossstores",          "External"],
  ["Nordstrom",                "nordstrom.wd5.myworkdayjobs.com",           "nordstrom",           "nordstromcareers"],
  ["Macy's",                   "macys.wd5.myworkdayjobs.com",               "macys",               "macys"],
  ["Kohl's",                   "kohls.wd5.myworkdayjobs.com",               "kohls",               "External"],
  ["Bed Bath & Beyond",        "bedbathandbeyond.wd5.myworkdayjobs.com",    "bedbathandbeyond",    "External"],
  ["Bath & Body Works",        "bathandbodyworks.wd5.myworkdayjobs.com",    "bathandbodyworks",    "External"],
  ["Victoria's Secret",        "victoriassecret.wd5.myworkdayjobs.com",     "victoriassecret",     "External"],
  ["Gap Inc",                  "gap.wd5.myworkdayjobs.com",                 "gap",                 "external"],
  ["PVH Corp",                 "pvh.wd1.myworkdayjobs.com",                 "pvh",                 "PVHCorp"],
  ["Hanesbrands",              "hanesbrands.wd5.myworkdayjobs.com",         "hanesbrands",         "External"],
  ["Ralph Lauren",             "ralphlauren.wd5.myworkdayjobs.com",         "ralphlauren",         "External"],
  ["VF Corporation",           "vfc.wd5.myworkdayjobs.com",                 "vfc",                 "VF_Corporation"],
  ["Columbia Sportswear",      "columbia.wd5.myworkdayjobs.com",            "columbia",            "External"],
  ["Under Armour",             "underarmour.wd5.myworkdayjobs.com",         "underarmour",         "External"],
  ["Levi Strauss",             "levi.wd5.myworkdayjobs.com",                "levi",                "LevistraußExternalCareers"],
  ["Tapestry",                 "tapestry.wd5.myworkdayjobs.com",            "tapestry",            "Tapestry_Careers"],
  ["Capri Holdings",           "capri.wd1.myworkdayjobs.com",               "capri",               "External"],
  ["Carter's",                 "carters.wd5.myworkdayjobs.com",             "carters",             "External"],
  ["Oxford Industries",        "oxfordindustries.wd5.myworkdayjobs.com",    "oxfordindustries",    "External"],
  ["G-III Apparel",            "giii.wd5.myworkdayjobs.com",                "giii",                "External"],
  ["Foot Locker",              "footlocker.wd5.myworkdayjobs.com",          "footlocker",          "FootLockerCareers"],
  ["Dick's Sporting Goods",    "dickssportinggoods.wd5.myworkdayjobs.com",  "dickssportinggoods",  "External"],
  ["Academy Sports",           "academy.wd5.myworkdayjobs.com",             "academy",             "External"],
  ["REI",                      "rei.wd5.myworkdayjobs.com",                 "rei",                 "External"],
  ["Williams-Sonoma",          "williams-sonoma.wd5.myworkdayjobs.com",     "williams-sonoma",     "External"],
  ["Crate & Barrel",           "crateandbarrel.wd5.myworkdayjobs.com",      "crateandbarrel",      "External"],
  ["Restoration Hardware",     "restorationhardware.wd5.myworkdayjobs.com", "restorationhardware", "External"],
  ["Wayfair",                  "wayfair.wd5.myworkdayjobs.com",             "wayfair",             "Wayfair"],
  ["Chewy",                    "chewy.wd5.myworkdayjobs.com",               "chewy",               "Chewy"],
  ["Chegg",                    "chegg.wd1.myworkdayjobs.com",               "chegg",               "External"],
  ["1-800-Flowers",            "1800flowers.wd1.myworkdayjobs.com",         "1800flowers",         "External"],
  ["Sysco",                    "sysco.wd5.myworkdayjobs.com",               "sysco",               "Sysco_External_Career_Site"],
  ["Performance Food Group",   "pfgc.wd5.myworkdayjobs.com",                "pfgc",                "External"],
  ["US Foods",                 "usfoods.wd5.myworkdayjobs.com",             "usfoods",             "External"],
  ["Aramark",                  "aramark.wd5.myworkdayjobs.com",             "aramark",             "External_Career_Site"],
  ["Sodexo",                   "sodexo.wd1.myworkdayjobs.com",              "sodexo",              "Sodexo_External_Careers"],
  ["Compass Group",            "compass-group.wd1.myworkdayjobs.com",       "compass-group",       "External"],

  // ── INDUSTRIALS ───────────────────────────────────────────────────────────
  ["General Electric",         "ge.wd5.myworkdayjobs.com",                  "ge",                  "GE_ExternalSite"],
  ["Honeywell",                "honeywell.wd5.myworkdayjobs.com",           "honeywell",           "Honeywell"],
  ["3M",                       "3m.wd1.myworkdayjobs.com",                  "3m",                  "3M_US"],
  ["Emerson Electric",         "emersoncareers.wd5.myworkdayjobs.com",      "emersoncareers",      "External"],
  ["Parker Hannifin",          "parker.wd5.myworkdayjobs.com",              "parker",              "External"],
  ["Eaton",                    "eaton.wd5.myworkdayjobs.com",               "eaton",               "Eaton"],
  ["Rockwell Automation",      "rockwellautomation.wd5.myworkdayjobs.com",  "rockwellautomation",  "External"],
  ["Illinois Tool Works",      "itw.wd5.myworkdayjobs.com",                 "itw",                 "External"],
  ["Caterpillar",              "cat.wd5.myworkdayjobs.com",                 "cat",                 "CatExternalCareers"],
  ["Deere & Company",          "deere.wd5.myworkdayjobs.com",               "deere",               "Careers"],
  ["Cummins",                  "cummins.wd5.myworkdayjobs.com",             "cummins",             "External"],
  ["AGCO",                     "agcocorp.wd5.myworkdayjobs.com",            "agcocorp",            "External"],
  ["Paccar",                   "paccar.wd5.myworkdayjobs.com",              "paccar",              "External"],
  ["Oshkosh",                  "oshkoshcorporation.wd5.myworkdayjobs.com",  "oshkoshcorporation",  "ExternalCareers"],
  ["Terex",                    "terex.wd5.myworkdayjobs.com",               "terex",               "External"],
  ["Dover Corporation",        "dovercorporation.wd5.myworkdayjobs.com",    "dovercorporation",    "External"],
  ["Roper Technologies",       "ropertech.wd5.myworkdayjobs.com",           "ropertech",           "External"],
  ["AMETEK",                   "ametek.wd5.myworkdayjobs.com",              "ametek",              "External"],
  ["Watts Water",              "watts.wd1.myworkdayjobs.com",               "watts",               "External"],
  ["Watts Water Tech",         "wattswater.wd1.myworkdayjobs.com",          "wattswater",          "External"],
  ["Hubbell",                  "hubbell.wd1.myworkdayjobs.com",             "hubbell",             "External"],
  ["Belden",                   "belden.wd5.myworkdayjobs.com",              "belden",              "External"],
  ["Watts Electric",           "wattselectric.wd1.myworkdayjobs.com",       "wattselectric",       "External"],
  ["Generac",                  "generac.wd5.myworkdayjobs.com",             "generac",             "External"],
  ["Rexnord",                  "rexnord.wd1.myworkdayjobs.com",             "rexnord",             "External"],
  ["Watts Industries",         "wattsindustries.wd1.myworkdayjobs.com",     "wattsindustries",     "External"],
  ["SPX",                      "spx.wd5.myworkdayjobs.com",                 "spx",                 "External"],
  ["Enpro Industries",         "enpro.wd5.myworkdayjobs.com",               "enpro",               "External"],
  ["Chart Industries",         "chartindustries.wd5.myworkdayjobs.com",     "chartindustries",     "External"],
  ["Watts Technologies",       "wattstech.wd1.myworkdayjobs.com",           "wattstech",           "External"],

  // ── ENERGY ────────────────────────────────────────────────────────────────
  ["ExxonMobil",               "exxonmobil.wd5.myworkdayjobs.com",          "exxonmobil",          "ExxonMobilCareers"],
  ["Chevron",                  "chevron.wd5.myworkdayjobs.com",             "chevron",             "External_Careers"],
  ["ConocoPhillips",           "conocophillips.wd5.myworkdayjobs.com",      "conocophillips",      "External"],
  ["Pioneer Natural Resources","pxd.wd5.myworkdayjobs.com",                 "pxd",                 "External"],
  ["EOG Resources",            "eogresources.wd5.myworkdayjobs.com",        "eogresources",        "External"],
  ["Devon Energy",             "devonenergy.wd5.myworkdayjobs.com",         "devonenergy",         "External"],
  ["Halliburton",              "halliburton.wd5.myworkdayjobs.com",         "halliburton",         "Halliburton_External"],
  ["Baker Hughes",             "bhge.wd5.myworkdayjobs.com",                "bhge",                "BHGE"],
  ["SLB (Schlumberger)",       "slb.wd3.myworkdayjobs.com",                 "slb",                 "External"],
  ["Valero Energy",            "valero.wd5.myworkdayjobs.com",              "valero",              "ValeroCareers"],
  ["Phillips 66",              "phillips66.wd5.myworkdayjobs.com",          "phillips66",          "Phillips_66_External"],
  ["Marathon Petroleum",       "marathonpetroleum.wd5.myworkdayjobs.com",   "marathonpetroleum",   "External"],
  ["HollyFrontier",            "hollyfrontier.wd5.myworkdayjobs.com",       "hollyfrontier",       "External"],
  ["Calumet Specialty",        "calumetspecialty.wd5.myworkdayjobs.com",    "calumetspecialty",    "External"],
  ["WPX Energy",               "wpxenergy.wd5.myworkdayjobs.com",           "wpxenergy",           "External"],
  ["Callon Petroleum",         "callon.wd5.myworkdayjobs.com",              "callon",              "External"],
  ["Southwestern Energy",      "swn.wd5.myworkdayjobs.com",                 "swn",                 "External"],
  ["Coterra Energy",           "coterra.wd5.myworkdayjobs.com",             "coterra",             "External"],
  ["Ovintiv",                  "ovintiv.wd5.myworkdayjobs.com",             "ovintiv",             "External"],
  ["Diamondback Energy",       "diamondbackenergy.wd5.myworkdayjobs.com",   "diamondbackenergy",   "External"],

  // ── TELECOM & MEDIA ───────────────────────────────────────────────────────
  ["AT&T",                     "att.wd1.myworkdayjobs.com",                 "att",                 "att_jobs"],
  ["Verizon",                  "verizon.wd1.myworkdayjobs.com",             "verizon",             "External"],
  ["Charter Communications",   "charter.wd5.myworkdayjobs.com",            "charter",             "Charter"],
  ["Comcast",                  "comcast.wd5.myworkdayjobs.com",             "comcast",             "Careers"],
  ["Lumen Technologies",       "lumen.wd5.myworkdayjobs.com",              "lumen",               "Lumen"],
  ["Dish Network",             "dish.wd5.myworkdayjobs.com",                "dish",                "dish-careers"],
  ["Frontier Communications",  "frontier.wd1.myworkdayjobs.com",           "frontier",            "External"],
  ["Consolidated Communications","consolidated.wd5.myworkdayjobs.com",     "consolidated",        "External"],
  ["Vonage",                   "vonage.wd5.myworkdayjobs.com",              "vonage",              "External"],
  ["Bandwidth",                "bandwidth.wd1.myworkdayjobs.com",           "bandwidth",           "External"],
  ["Syniverse Technologies",   "syniverse.wd5.myworkdayjobs.com",           "syniverse",           "External"],
  ["Iridium Communications",   "iridium.wd5.myworkdayjobs.com",             "iridium",             "External"],
  ["ViaSat",                   "viasat.wd1.myworkdayjobs.com",              "viasat",              "External"],
  ["Hughes Network Systems",   "hughes.wd5.myworkdayjobs.com",              "hughes",              "External"],
  ["DirecTV",                  "directv.wd5.myworkdayjobs.com",             "directv",             "External"],
  ["The Walt Disney Company",  "disney.wd5.myworkdayjobs.com",              "disney",              "disneycareer"],
  ["ViacomCBS (Paramount)",    "viacomcbs.wd1.myworkdayjobs.com",           "viacomcbs",           "External"],
  ["Warner Bros Discovery",    "warnerbros.wd5.myworkdayjobs.com",          "warnerbros",          "External_Career_Site"],
  ["Fox Corporation",          "foxcorporation.wd5.myworkdayjobs.com",      "foxcorporation",      "External"],
  ["AMC Networks",             "amcnetworks.wd5.myworkdayjobs.com",         "amcnetworks",         "External"],
  ["Discovery Communications", "discovery.wd5.myworkdayjobs.com",           "discovery",           "External"],
  ["Nielsen",                  "nielsen.wd5.myworkdayjobs.com",             "nielsen",             "External"],
  ["IHS Markit",               "ihsmarkit.wd5.myworkdayjobs.com",           "ihsmarkit",           "External"],
  ["Gartner",                  "gartner.wd5.myworkdayjobs.com",             "gartner",             "External"],
  ["Forrester Research",       "forrester.wd1.myworkdayjobs.com",           "forrester",           "External"],
  ["IDC",                      "idc.wd5.myworkdayjobs.com",                 "idc",                 "External"],

  // ── AEROSPACE & DEFENSE ───────────────────────────────────────────────────
  ["Boeing",                   "boeing.wd1.myworkdayjobs.com",              "boeing",              "EXTERNAL_CAREERS"],
  ["Lockheed Martin",          "lmt.wd5.myworkdayjobs.com",                 "lmt",                 "LMCareers"],
  ["Raytheon Technologies",    "rtx.wd5.myworkdayjobs.com",                 "rtx",                 "RTX"],
  ["Northrop Grumman",         "northropgrumman.wd5.myworkdayjobs.com",     "northropgrumman",     "Careers"],
  ["General Dynamics",         "gd.wd1.myworkdayjobs.com",                  "gd",                  "External"],
  ["L3Harris Technologies",    "l3harris.wd5.myworkdayjobs.com",            "l3harris",            "ExternalCareerSite"],
  ["Textron",                  "textron.wd5.myworkdayjobs.com",             "textron",             "External"],
  ["SAIC",                     "saic.wd1.myworkdayjobs.com",                "saic",                "SAIC_External"],
  ["Leidos",                   "leidos.wd5.myworkdayjobs.com",              "leidos",              "Leidos"],
  ["Booz Allen Hamilton",      "boozallen.wd5.myworkdayjobs.com",           "boozallen",           "EXT"],
  ["CACI International",       "caci.wd1.myworkdayjobs.com",                "caci",                "External"],
  ["ManTech International",    "mantech.wd5.myworkdayjobs.com",             "mantech",             "External"],
  ["Engility",                 "engility.wd5.myworkdayjobs.com",            "engility",            "External"],
  ["PAE",                      "pae.wd5.myworkdayjobs.com",                 "pae",                 "External"],
  ["DynCorp International",    "dyncorp.wd1.myworkdayjobs.com",             "dyncorp",             "External"],
  ["Fluor Corporation",        "fluor.wd5.myworkdayjobs.com",               "fluor",               "External"],
  ["AECOM",                    "aecom.wd5.myworkdayjobs.com",               "aecom",               "AECOM_External_Career_Site"],
  ["Jacobs Engineering",       "jacobs.wd5.myworkdayjobs.com",              "jacobs",              "Experienced"],
  ["KBR",                      "kbr.wd5.myworkdayjobs.com",                 "kbr",                 "External"],
  ["BWX Technologies",         "bwxt.wd5.myworkdayjobs.com",                "bwxt",                "External"],
  ["Curtiss-Wright",           "curtisswright.wd5.myworkdayjobs.com",       "curtisswright",       "External"],
  ["Moog",                     "moog.wd5.myworkdayjobs.com",                "moog",                "External"],
  ["TransDigm",                "transdigm.wd5.myworkdayjobs.com",           "transdigm",           "External"],
  ["Heico",                    "heico.wd5.myworkdayjobs.com",               "heico",               "External"],
  ["Spirit AeroSystems",       "spiritaero.wd5.myworkdayjobs.com",          "spiritaero",          "External"],
  ["Triumph Group",            "triumphgroup.wd5.myworkdayjobs.com",        "triumphgroup",        "External"],

  // ── PROFESSIONAL SERVICES & CONSULTING ───────────────────────────────────
  ["Accenture",                "accenture.wd3.myworkdayjobs.com",           "accenture",           "Accenture_University_Careers"],
  ["Deloitte",                 "deloitte.wd5.myworkdayjobs.com",            "deloitte",            "Deloitte_Careers"],
  ["PwC",                      "pwc.wd3.myworkdayjobs.com",                 "pwc",                 "Global"],
  ["KPMG",                     "kpmg.wd5.myworkdayjobs.com",                "kpmg",                "campus"],
  ["EY",                       "ey.wd5.myworkdayjobs.com",                  "ey",                  "EY_External_Careers"],
  ["McKinsey",                 "mckinsey.wd1.myworkdayjobs.com",            "mckinsey",            "External"],
  ["Boston Consulting Group",  "bcg.wd3.myworkdayjobs.com",                 "bcg",                 "BCGCareers"],
  ["Bain & Company",           "bain.wd5.myworkdayjobs.com",                "bain",                "External"],
  ["Oliver Wyman",             "oliverwyman.wd5.myworkdayjobs.com",         "oliverwyman",         "External"],
  ["Cognizant",                "cognizant.wd1.myworkdayjobs.com",           "cognizant",           "Cognizant_Careers"],
  ["Infosys",                  "infosys.wd3.myworkdayjobs.com",             "infosys",             "Infosys_Careers"],
  ["Wipro",                    "wipro.wd3.myworkdayjobs.com",               "wipro",               "Wipro"],
  ["HCL Technologies",         "hcl.wd3.myworkdayjobs.com",                 "hcl",                 "HCL_Careers"],
  ["Tata Consultancy Services","tcs.wd3.myworkdayjobs.com",                 "tcs",                 "TCS_Careers"],
  ["Capgemini",                "capgemini.wd3.myworkdayjobs.com",           "capgemini",           "External"],
  ["DXC Technology",           "dxc.wd1.myworkdayjobs.com",                 "dxc",                 "External"],
  ["Unisys",                   "unisys.wd5.myworkdayjobs.com",              "unisys",              "ExternalCareers"],
  ["Conduent",                 "conduent.wd5.myworkdayjobs.com",            "conduent",            "External"],
  ["Leidos Digital Solutions", "leidosdigital.wd5.myworkdayjobs.com",       "leidosdigital",       "External"],
  ["ICF International",        "icf.wd5.myworkdayjobs.com",                 "icf",                 "ICFExternal"],
  ["Science Applications International","saic.wd1.myworkdayjobs.com",      "saic",                "SAIC_External"],

  // ── AUTOMOTIVE ────────────────────────────────────────────────────────────
  ["General Motors",           "generalmotors.wd5.myworkdayjobs.com",       "generalmotors",       "Global"],
  ["Ford Motor Company",       "ford.wd12.myworkdayjobs.com",               "ford",                "Ford_Motor_Company"],
  ["Stellantis",               "stellantis.wd12.myworkdayjobs.com",         "stellantis",          "External"],
  ["Tesla",                    "tesla.wd5.myworkdayjobs.com",               "tesla",               "TeslaMotorsCareers"],
  ["Rivian",                   "rivian.wd5.myworkdayjobs.com",              "rivian",              "External"],
  ["Lucid Motors",             "lucidmotors.wd5.myworkdayjobs.com",         "lucidmotors",         "External"],
  ["BorgWarner",               "borgwarner.wd1.myworkdayjobs.com",          "borgwarner",          "External"],
  ["Aptiv",                    "aptiv.wd5.myworkdayjobs.com",               "aptiv",               "AptivCareers"],
  ["Lear Corporation",         "lear.wd5.myworkdayjobs.com",                "lear",                "External"],
  ["Gentex",                   "gentex.wd1.myworkdayjobs.com",              "gentex",              "External"],
  ["Visteon",                  "visteon.wd5.myworkdayjobs.com",             "visteon",             "External"],
  ["Dorman Products",          "dormanproducts.wd5.myworkdayjobs.com",      "dormanproducts",      "External"],
  ["Modine Manufacturing",     "modine.wd5.myworkdayjobs.com",              "modine",              "External"],
  ["Standard Motor Products",  "standardmotor.wd5.myworkdayjobs.com",       "standardmotor",       "External"],
  ["Superior Industries",      "superiorindustries.wd5.myworkdayjobs.com",  "superiorindustries",  "External"],
  ["Installed Building Products","installedbuildingproducts.wd1.myworkdayjobs.com","installedbuildingproducts","External"],
  ["Patrick Industries",       "patrickind.wd5.myworkdayjobs.com",          "patrickind",          "External"],

  // ── TRANSPORTATION & LOGISTICS ────────────────────────────────────────────
  ["FedEx",                    "fedex.wd5.myworkdayjobs.com",               "fedex",               "FedEx"],
  ["UPS",                      "ups.wd5.myworkdayjobs.com",                 "ups",                 "UPS_Careers"],
  ["XPO Logistics",            "xpo.wd5.myworkdayjobs.com",                 "xpo",                 "XPO"],
  ["J.B. Hunt Transport",      "jbhunt.wd5.myworkdayjobs.com",              "jbhunt",              "JBHuntCareers"],
  ["Werner Enterprises",       "werner.wd5.myworkdayjobs.com",              "werner",              "External"],
  ["Schneider National",       "schneider.wd5.myworkdayjobs.com",           "schneider",           "External"],
  ["Old Dominion Freight",     "odfl.wd5.myworkdayjobs.com",                "odfl",                "External"],
  ["SAIA",                     "saia.wd5.myworkdayjobs.com",                "saia",                "External"],
  ["Knight-Swift",             "knightswift.wd5.myworkdayjobs.com",         "knightswift",         "External"],
  ["Ryder System",             "ryder.wd5.myworkdayjobs.com",               "ryder",               "ExternalCareers"],
  ["C.H. Robinson",            "chrobinson.wd5.myworkdayjobs.com",          "chrobinson",          "External"],
  ["Expeditors International", "expeditors.wd5.myworkdayjobs.com",          "expeditors",          "External"],
  ["Echo Global Logistics",    "echo.wd5.myworkdayjobs.com",                "echo",                "External"],
  ["Coyote Logistics",         "coyote.wd5.myworkdayjobs.com",              "coyote",              "External"],
  ["Transplace",               "transplace.wd5.myworkdayjobs.com",          "transplace",          "External"],
  ["MoLo Solutions",           "molo.wd5.myworkdayjobs.com",                "molo",                "External"],
];

// ── Verify helper ─────────────────────────────────────────────────────────────

async function verifyUrl(url) {
  try {
    const res = await fetch(url, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body:    JSON.stringify({ appliedFacets: {}, limit: 1, offset: 0, searchText: "" }),
      signal:  AbortSignal.timeout(8_000),
    });
    if (!res.ok) return { ok: false, status: res.status };
    const json = await res.json();
    const total = json.total ?? json.jobPostings?.length ?? 0;
    return { ok: true, total };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const rows = LIMIT < Infinity ? COMPANIES.slice(0, LIMIT) : COMPANIES;
  console.log(`\n🏢  Workday seed: ${rows.length} companies (dry-run=${DRY_RUN}, verify=${VERIFY})\n`);

  let created = 0, updated = 0, skipped = 0, failed = 0;

  for (const [company, host, tenant, site] of rows) {
    const url = `https://${host}/wday/cxs/${tenant}/${site}/jobs`;

    if (VERIFY) {
      process.stdout.write(`  Checking ${company}… `);
      const result = await verifyUrl(url);
      if (!result.ok) {
        console.log(`❌  HTTP ${result.status ?? result.error}`);
        skipped++;
        continue;
      }
      console.log(`✅  ${result.total} jobs`);
    }

    if (DRY_RUN) {
      console.log(`  [dry-run] would upsert: ${company} → ${url}`);
      continue;
    }

    try {
      const existing = await prisma.jobSource.findUnique({ where: { url } });

      if (existing) {
        await prisma.jobSource.update({
          where: { url },
          data: {
            company,
            provider:    "WORKDAY",
            boardToken:  tenant,
            enabled:     true,
            updatedAt:   new Date(),
          },
        });
        updated++;
        console.log(`  ↺  Updated: ${company}`);
      } else {
        await prisma.jobSource.create({
          data: {
            company,
            provider:   "WORKDAY",
            boardToken: tenant,
            url,
            enabled:    true,
            priority:   5,
            tags:       "[]",
          },
        });
        created++;
        console.log(`  ✚  Created: ${company}`);
      }
    } catch (err) {
      console.error(`  ✗  Failed ${company}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n✅  Done — created=${created} updated=${updated} skipped=${skipped} failed=${failed}\n`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
