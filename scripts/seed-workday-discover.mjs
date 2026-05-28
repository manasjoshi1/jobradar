#!/usr/bin/env node
/**
 * scripts/seed-workday-discover.mjs
 *
 * Seeds Workday JobSource rows by AUTO-DISCOVERING the site slug for each host
 * via the /en-US/ HTTP redirect (Workday redirects to the live career site URL).
 *
 * URL format: https://{host}/wday/cxs/{tenant}/{site}/jobs
 * Discovery : GET https://{host}/en-US/  →  redirects to  /en-US/{site}[/...]
 *
 * Usage:
 *   node scripts/seed-workday-discover.mjs               # discover + seed
 *   node scripts/seed-workday-discover.mjs --dry-run     # print only
 *   node scripts/seed-workday-discover.mjs --limit=50    # first N hosts
 *   node scripts/seed-workday-discover.mjs --concurrency=5  # parallel workers
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const args   = process.argv.slice(2);
const DRY_RUN     = args.includes("--dry-run");
const LIMIT       = (() => { const l = args.find(a => a.startsWith("--limit="));    return l ? parseInt(l.split("=")[1], 10) : Infinity; })();
const CONCURRENCY = (() => { const c = args.find(a => a.startsWith("--concurrency=")); return c ? parseInt(c.split("=")[1], 10) : 3; })();
const TIMEOUT_MS  = 12_000;

// ── Company list ──────────────────────────────────────────────────────────────
// Format: [displayName, workdayHost]
// tenant is auto-derived as the first subdomain segment.
// site is auto-discovered via /en-US/ redirect.
// Source: customer-provided domain list (myworkdayjobs.com hosts confirmed).
// ─────────────────────────────────────────────────────────────────────────────

const COMPANIES = [
  // ── US TECHNOLOGY ────────────────────────────────────────────────────────
  ["NVIDIA",                          "nvidia.wd5.myworkdayjobs.com"],
  ["Adobe",                           "adobe.wd5.myworkdayjobs.com"],
  ["Workday",                         "workday.wd5.myworkdayjobs.com"],
  ["Salesforce",                      "salesforce.wd12.myworkdayjobs.com"],
  ["Autodesk",                        "autodesk.wd1.myworkdayjobs.com"],
  ["Intel Corporation",               "intel.wd1.myworkdayjobs.com"],
  ["HP Inc",                          "hp.wd5.myworkdayjobs.com"],
  ["Hewlett Packard Enterprise",      "hpe.wd5.myworkdayjobs.com"],
  ["Broadcom",                        "broadcom.wd1.myworkdayjobs.com"],
  ["Micron Technology",               "micron.wd1.myworkdayjobs.com"],
  ["Applied Materials",               "amat.wd1.myworkdayjobs.com"],
  ["Cadence Design Systems",          "cadence.wd1.myworkdayjobs.com"],
  ["KLA Corporation",                 "kla.wd1.myworkdayjobs.com"],
  ["Marvell Technology",              "marvell.wd1.myworkdayjobs.com"],
  ["Analog Devices",                  "analogdevices.wd1.myworkdayjobs.com"],
  ["Motorola Solutions",              "motorolasolutions.wd5.myworkdayjobs.com"],
  ["Palo Alto Networks",              "paloaltonetworks.wd5.myworkdayjobs.com"],
  ["CrowdStrike",                     "crowdstrike.wd5.myworkdayjobs.com"],
  ["Proofpoint",                      "proofpoint.wd5.myworkdayjobs.com"],
  ["Fortinet",                        "fortinet.wd1.myworkdayjobs.com"],
  ["VIAVI Solutions",                 "viavisolutions.wd1.myworkdayjobs.com"],
  ["eBay",                            "ebay.wd5.myworkdayjobs.com"],
  ["PayPal",                          "paypal.wd1.myworkdayjobs.com"],
  ["Snap Inc",                        "snapchat.wd1.myworkdayjobs.com"],
  ["Expedia Group",                   "expedia.wd108.myworkdayjobs.com"],
  ["Zillow",                          "zillow.wd5.myworkdayjobs.com"],
  ["Zoom",                            "zoom.wd5.myworkdayjobs.com"],
  ["Remitly",                         "remitly.wd5.myworkdayjobs.com"],
  ["Wayfair",                         "wayfair.wd5.myworkdayjobs.com"],
  ["ServiceTitan",                    "servicetitan.wd1.myworkdayjobs.com"],
  ["Procore Technologies",            "procore.wd12.myworkdayjobs.com"],
  ["nCino",                           "ncino.wd5.myworkdayjobs.com"],
  ["Alteryx",                         "alteryx.wd108.myworkdayjobs.com"],
  ["Exact Sciences",                  "exactsciences.wd1.myworkdayjobs.com"],
  ["FICO",                            "fico.wd1.myworkdayjobs.com"],
  ["Zebra Technologies",              "zebra.wd501.myworkdayjobs.com"],
  ["LiveRamp",                        "liveramp.wd5.myworkdayjobs.com"],
  ["Q2",                              "q2ebanking.wd5.myworkdayjobs.com"],
  ["Morningstar",                     "morningstar.wd5.myworkdayjobs.com"],
  ["FactSet",                         "factset.wd108.myworkdayjobs.com"],
  ["S&P Global",                      "spgi.wd5.myworkdayjobs.com"],
  ["Clearwater Analytics",            "clearwateranalytics.wd1.myworkdayjobs.com"],
  ["Asurion",                         "asurion.wd5.myworkdayjobs.com"],
  ["Waystar",                         "waystar.wd1.myworkdayjobs.com"],
  ["Gartner",                         "gartner.wd5.myworkdayjobs.com"],
  ["IHS Markit / RELX",               "relx.wd3.myworkdayjobs.com"],
  ["Thomson Reuters",                 "thomsonreuters.wd5.myworkdayjobs.com"],
  ["CoStar Group",                    "costar.wd1.myworkdayjobs.com"],
  ["PTC",                             "ptc.wd1.myworkdayjobs.com"],
  ["Aspen Technology",                "aspentech.wd5.myworkdayjobs.com"],
  ["Wolters Kluwer",                  "wk.wd3.myworkdayjobs.com"],
  ["CDK Global",                      "cdk.wd1.myworkdayjobs.com"],
  ["Litera",                          "litera.wd12.myworkdayjobs.com"],
  ["CCC Intelligent Solutions",       "cccis.wd1.myworkdayjobs.com"],
  ["Intapp",                          "intapp.wd1.myworkdayjobs.com"],
  ["Veralto",                         "veralto.wd1.myworkdayjobs.com"],
  ["Cloudera",                        "cloudera.wd5.myworkdayjobs.com"],
  ["TIBCO / Cloud Software Group",    "tibco.wd5.myworkdayjobs.com"],
  ["DataRobot",                       "datarobot.wd1.myworkdayjobs.com"],
  ["Broadridge Financial",            "broadridge.wd5.myworkdayjobs.com"],
  ["FIS",                             "fis.wd5.myworkdayjobs.com"],
  ["Fiserv",                          "fiserv.wd5.myworkdayjobs.com"],
  ["Global Payments / TSYS",          "tsys.wd1.myworkdayjobs.com"],
  ["Worldpay",                        "worldpay.wd5.myworkdayjobs.com"],
  ["First American",                  "firstam.wd1.myworkdayjobs.com"],
  ["SS&C Technologies",               "ssctech.wd1.myworkdayjobs.com"],
  ["Copart",                          "copart.wd12.myworkdayjobs.com"],
  ["NCR Atleos",                      "ncratleos.wd1.myworkdayjobs.com"],
  ["NCR Corporation",                 "ncr.wd1.myworkdayjobs.com"],
  ["Red Hat",                         "redhat.wd5.myworkdayjobs.com"],
  ["DXC Technology",                  "dxctechnology.wd1.myworkdayjobs.com"],
  ["Unisys",                          "unisys.wd5.myworkdayjobs.com"],
  ["Ingram Micro",                    "ingrammicro.wd5.myworkdayjobs.com"],
  ["Omnissa",                         "omnissa.wd501.myworkdayjobs.com"],
  ["Cohesity",                        "cohesity.wd5.myworkdayjobs.com"],
  ["AVEVA",                           "aveva.wd3.myworkdayjobs.com"],
  ["Trend Micro",                     "trendmicro.wd3.myworkdayjobs.com"],
  ["Merative",                        "merative.wd12.myworkdayjobs.com"],
  ["Silicon Labs",                    "silabs.wd1.myworkdayjobs.com"],
  ["McAfee",                          "mcafee.wd1.myworkdayjobs.com"],
  ["Symbotic",                        "symbotic.wd504.myworkdayjobs.com"],
  ["8x8",                             "8x8inc.wd5.myworkdayjobs.com"],
  ["Sonos",                           "sonos.wd1.myworkdayjobs.com"],
  ["GoodRx",                          "goodrx.wd1.myworkdayjobs.com"],
  ["Tempus AI",                       "tempus.wd5.myworkdayjobs.com"],
  ["Xbox Gaming (Microsoft)",         "xboxgaming.wd1.myworkdayjobs.com"],
  ["Blizzard/Activision",             "xboxgaming.wd1.myworkdayjobs.com"],

  // ── FINANCIAL SERVICES ────────────────────────────────────────────────────
  ["Morgan Stanley",                  "ms.wd5.myworkdayjobs.com"],
  ["Wells Fargo",                     "wf.wd1.myworkdayjobs.com"],
  ["Citi",                            "citi.wd5.myworkdayjobs.com"],
  ["Capital One",                     "capitalone.wd12.myworkdayjobs.com"],
  ["Bank of America",                 "ghr.wd1.myworkdayjobs.com"],
  ["US Bank",                         "usbank.wd1.myworkdayjobs.com"],
  ["PNC Financial",                   "pnc.wd5.myworkdayjobs.com"],
  ["Regions Bank",                    "regions.wd5.myworkdayjobs.com"],
  ["TD Bank",                         "td.wd3.myworkdayjobs.com"],
  ["Fifth Third Bank",                "fifththird.wd5.myworkdayjobs.com"],
  ["Truist",                          "truist.wd1.myworkdayjobs.com"],
  ["Visa",                            "visa.wd5.myworkdayjobs.com"],
  ["Mastercard",                      "mastercard.wd1.myworkdayjobs.com"],
  ["Fidelity Investments",            "fmr.wd1.myworkdayjobs.com"],
  ["Vanguard",                        "vanguard.wd5.myworkdayjobs.com"],
  ["State Street",                    "statestreet.wd1.myworkdayjobs.com"],
  ["BlackRock",                       "blackrock.wd1.myworkdayjobs.com"],
  ["T. Rowe Price",                   "troweprice.wd5.myworkdayjobs.com"],
  ["Northern Trust",                  "ntrs.wd1.myworkdayjobs.com"],
  ["Ameriprise Financial",            "ameriprise.wd5.myworkdayjobs.com"],
  ["LPL Financial",                   "lplfinancial.wd1.myworkdayjobs.com"],
  ["MFS Investment Management",       "mfs.wd1.myworkdayjobs.com"],
  ["American Century Investments",    "americancentury.wd5.myworkdayjobs.com"],
  ["PIMCO",                           "pimco.wd1.myworkdayjobs.com"],
  ["AllianceBernstein",               "abglobal.wd1.myworkdayjobs.com"],
  ["SEI Investments",                 "seic.wd1.myworkdayjobs.com"],
  ["Wellington Management",           "wellington.wd5.myworkdayjobs.com"],
  ["Empower Retirement",              "empower.wd12.myworkdayjobs.com"],
  ["Transamerica",                    "transamerica.wd5.myworkdayjobs.com"],
  ["Newrez LLC",                      "newrez.wd1.myworkdayjobs.com"],
  ["Rocket Companies",                "quickenloans.wd5.myworkdayjobs.com"],
  ["USAA",                            "usaa.wd1.myworkdayjobs.com"],
  ["Freddie Mac",                     "freddiemac.wd5.myworkdayjobs.com"],
  ["Travelers",                       "travelers.wd5.myworkdayjobs.com"],
  ["Allstate",                        "allstate.wd5.myworkdayjobs.com"],
  ["The Hartford",                    "thehartford.wd5.myworkdayjobs.com"],
  ["Nationwide",                      "nationwide.wd1.myworkdayjobs.com"],
  ["Guardian Life",                   "guardianlife.wd5.myworkdayjobs.com"],
  ["Northwestern Mutual",             "northwesternmutual.wd5.myworkdayjobs.com"],
  ["National Indemnity (Berkshire)",  "nationalindemnity.wd5.myworkdayjobs.com"],
  ["FINRA",                           "finra.wd1.myworkdayjobs.com"],
  ["Cboe Global Markets",             "cboe.wd1.myworkdayjobs.com"],
  ["CNA Insurance",                   "cna.wd1.myworkdayjobs.com"],
  ["Equifax",                         "equifax.wd5.myworkdayjobs.com"],
  ["Early Warning Services (Zelle)",  "earlywarning.wd5.myworkdayjobs.com"],
  ["Webster Bank",                    "websteronline.wd12.myworkdayjobs.com"],
  ["MissionSquare",                   "icmarc.wd108.myworkdayjobs.com"],
  ["ReliaQuest",                      "reliaquest.wd5.myworkdayjobs.com"],
  ["Triumph Financial",               "tbkbank.wd1.myworkdayjobs.com"],
  ["Zelis",                           "zelis.wd1.myworkdayjobs.com"],
  ["Encova Insurance",                "encova.wd1.myworkdayjobs.com"],
  ["LSEG",                            "lseg.wd3.myworkdayjobs.com"],
  ["Barclays",                        "barclays.wd3.myworkdayjobs.com"],
  ["RBC",                             "rbc.wd3.myworkdayjobs.com"],
  ["CIBC",                            "cibc.wd3.myworkdayjobs.com"],
  ["CPP Investments",                 "cppib.wd10.myworkdayjobs.com"],
  ["Insperity",                       "insperity.wd12.myworkdayjobs.com"],
  ["WEX",                             "wexinc.wd5.myworkdayjobs.com"],
  ["Fragomen",                        "fragomen.wd115.myworkdayjobs.com"],
  ["Allied Solutions",                "alliedsolutions.wd501.myworkdayjobs.com"],
  ["Apex Fintech / PEAK6",            "peak6group.wd1.myworkdayjobs.com"],

  // ── HEALTHCARE & LIFE SCIENCES ────────────────────────────────────────────
  ["Abbott Laboratories",             "abbott.wd5.myworkdayjobs.com"],
  ["Eli Lilly",                       "lilly.wd5.myworkdayjobs.com"],
  ["Medtronic",                       "medtronic.wd1.myworkdayjobs.com"],
  ["Stryker",                         "stryker.wd1.myworkdayjobs.com"],
  ["Johnson & Johnson",               "jj.wd5.myworkdayjobs.com"],
  ["Baxter International",            "baxter.wd1.myworkdayjobs.com"],
  ["BD (Becton Dickinson)",           "bdx.wd1.myworkdayjobs.com"],
  ["Danaher Corporation",             "danaher.wd1.myworkdayjobs.com"],
  ["Thermo Fisher Scientific",        "thermofisher.wd5.myworkdayjobs.com"],
  ["GE HealthCare",                   "gehc.wd5.myworkdayjobs.com"],
  ["Revvity",                         "revvity.wd103.myworkdayjobs.com"],
  ["Agilent Technologies",            "agilent.wd5.myworkdayjobs.com"],
  ["IDEXX Laboratories",              "idexx.wd1.myworkdayjobs.com"],
  ["Insulet Corporation",             "insulet.wd5.myworkdayjobs.com"],
  ["LivaNova",                        "livanova.wd5.myworkdayjobs.com"],
  ["Envista Holdings",                "envista.wd1.myworkdayjobs.com"],
  ["Smith+Nephew",                    "smithnephew.wd5.myworkdayjobs.com"],
  ["CONMED Corporation",              "conmed.wd5.myworkdayjobs.com"],
  ["ZOLL Medical",                    "zoll.wd5.myworkdayjobs.com"],
  ["iRhythm Technologies",            "irhythmtech.wd5.myworkdayjobs.com"],
  ["Accuray",                         "accuray.wd5.myworkdayjobs.com"],
  ["Tandem Diabetes Care",            "tandemdiabetes.wd12.myworkdayjobs.com"],
  ["PAREXEL",                         "parexel.wd1.myworkdayjobs.com"],
  ["BeiGene",                         "beigene.wd5.myworkdayjobs.com"],
  ["CSL",                             "csl.wd1.myworkdayjobs.com"],
  ["Roche / Genentech",               "roche.wd3.myworkdayjobs.com"],
  ["Philips",                         "philips.wd3.myworkdayjobs.com"],
  ["Siemens Healthineers",            "onehealthineers.wd3.myworkdayjobs.com"],
  ["Teladoc Health",                  "teladoc.wd503.myworkdayjobs.com"],
  ["CVS Health",                      "cvshealth.wd1.myworkdayjobs.com"],
  ["Humana",                          "humana.wd5.myworkdayjobs.com"],
  ["Elevance Health",                 "elevancehealth.wd1.myworkdayjobs.com"],
  ["McKesson",                        "mckesson.wd3.myworkdayjobs.com"],
  ["Cigna",                           "cigna.wd5.myworkdayjobs.com"],
  ["Centene",                         "centene.wd1.myworkdayjobs.com"],
  ["Vanderbilt University Medical Ctr","vumc.wd1.myworkdayjobs.com"],
  ["Sentara Health",                  "sentara.wd1.myworkdayjobs.com"],
  ["Sanford Health",                  "sanford.wd5.myworkdayjobs.com"],
  ["Stanford Health Care",            "stanfordhealthcare.wd5.myworkdayjobs.com"],
  ["BlueCross BlueShield Tennessee",  "bcbst.wd1.myworkdayjobs.com"],
  ["Blue Cross Blue Shield Nebraska", "nebraskablue.wd1.myworkdayjobs.com"],
  ["Blue Cross Blue Shield Arizona",  "bcbsaz.wd1.myworkdayjobs.com"],
  ["BlueCross BlueShield Louisiana",  "bcbsla.wd1.myworkdayjobs.com"],
  ["CorroHealth",                     "corrohealth.wd1.myworkdayjobs.com"],
  ["Vizient",                         "vizient.wd1.myworkdayjobs.com"],
  ["WellSky",                         "wellsky.wd1.myworkdayjobs.com"],
  ["ModMed",                          "modmed.wd501.myworkdayjobs.com"],
  ["Netsmart Technologies",           "ntst.wd1.myworkdayjobs.com"],
  ["TRIMEDX",                         "trimedx.wd1.myworkdayjobs.com"],
  ["LabCorp",                         "labcorp.wd5.myworkdayjobs.com"],
  ["Quest Diagnostics",               "questdiagnostics.wd5.myworkdayjobs.com"],
  ["Ensora Health (Therapy Brands)",  "therapybrands.wd1.myworkdayjobs.com"],
  ["Vera Whole Health",               "verawholehealth.wd1.myworkdayjobs.com"],
  ["ChenMed",                         "chenmed.wd1.myworkdayjobs.com"],
  ["Streamline Healthcare Solutions", "streamlinehealthcare.wd501.myworkdayjobs.com"],
  ["QuidelOrtho",                     "orthoclinical.wd1.myworkdayjobs.com"],

  // ── RETAIL & CONSUMER ────────────────────────────────────────────────────
  ["Walmart",                         "walmart.wd5.myworkdayjobs.com"],
  ["Target",                          "target.wd5.myworkdayjobs.com"],
  ["Home Depot",                      "homedepot.wd5.myworkdayjobs.com"],
  ["Lowe's",                          "lowes.wd5.myworkdayjobs.com"],
  ["Nordstrom",                       "nordstrom.wd501.myworkdayjobs.com"],
  ["Dick's Sporting Goods",           "dickssportinggoods.wd1.myworkdayjobs.com"],
  ["O'Reilly Auto Parts",             "oreillyauto.wd1.myworkdayjobs.com"],
  ["Advance Auto Parts",              "advanceauto.wd5.myworkdayjobs.com"],
  ["Gap Inc",                         "gapinc.wd1.myworkdayjobs.com"],
  ["Shake Shack",                     "shakeshack.wd5.myworkdayjobs.com"],
  ["Hy-Vee",                          "hyvee.wd1.myworkdayjobs.com"],
  ["RaceTrac",                        "racetrac.wd5.myworkdayjobs.com"],
  ["Fabletics / JustFab",             "justfab.wd1.myworkdayjobs.com"],
  ["The RealReal",                    "therealreal.wd1.myworkdayjobs.com"],
  ["Chewy",                           "chewy.wd5.myworkdayjobs.com"],
  ["O'Reilly (auto)",                 "oreillyauto.wd1.myworkdayjobs.com"],
  ["Uline",                           "uline.wd1.myworkdayjobs.com"],
  ["DriveTime",                       "drivetime.wd1.myworkdayjobs.com"],
  ["Etsy",                            "etsy.wd5.myworkdayjobs.com"],
  ["Sunbelt Rentals",                 "sunbeltrentals.wd1.myworkdayjobs.com"],
  ["Republic Services",               "republic.wd5.myworkdayjobs.com"],
  ["Life Fitness",                    "lifefitness.wd1.myworkdayjobs.com"],
  ["Trek Bikes",                      "trekbikes.wd1.myworkdayjobs.com"],
  ["New Balance",                     "newbalance.wd1.myworkdayjobs.com"],
  ["LEGO Group",                      "lego.wd103.myworkdayjobs.com"],

  // ── FOOD, BEVERAGE & HOSPITALITY ─────────────────────────────────────────
  ["Live Nation Entertainment",       "livenation.wd503.myworkdayjobs.com"],
  ["Las Vegas Sands",                 "sands.wd1.myworkdayjobs.com"],
  ["Boys Town",                       "boystown.wd1.myworkdayjobs.com"],

  // ── INDUSTRIALS & MANUFACTURING ──────────────────────────────────────────
  ["GE Aerospace",                    "geaerospace.wd5.myworkdayjobs.com"],
  ["GE Vernova",                      "gevernova.wd5.myworkdayjobs.com"],
  ["GE Appliances (Haier)",           "haier.wd3.myworkdayjobs.com"],
  ["Caterpillar Inc",                 "cat.wd5.myworkdayjobs.com"],
  ["Illinois Tool Works",             "itw.wd5.myworkdayjobs.com"],
  ["Oshkosh Corporation",             "oshkoshcorporation.wd5.myworkdayjobs.com"],
  ["Rockwell Automation",             "rockwellautomation.wd1.myworkdayjobs.com"],
  ["Deere & Company",                 "deere.wd5.myworkdayjobs.com"],
  ["Eaton",                           "eaton.wd5.myworkdayjobs.com"],
  ["Parker Hannifin",                 "parker.wd5.myworkdayjobs.com"],
  ["Xylem",                           "xylem.wd5.myworkdayjobs.com"],
  ["Moog Inc",                        "moog.wd5.myworkdayjobs.com"],
  ["Terex Corporation",               "terex.wd1.myworkdayjobs.com"],
  ["Stanley Black & Decker",          "sbdinc.wd1.myworkdayjobs.com"],
  ["Generac Power Systems",           "generac.wd5.myworkdayjobs.com"],
  ["Watts Water Technologies",        "wattswater.wd5.myworkdayjobs.com"],
  ["Woodward Inc",                    "woodward.wd5.myworkdayjobs.com"],
  ["Curtiss-Wright",                  "curtisswright.wd1.myworkdayjobs.com"],
  ["Brunswick Corporation",           "brunswick.wd1.myworkdayjobs.com"],
  ["Simpson Strong-Tie",              "strongtie.wd1.myworkdayjobs.com"],
  ["Hyster-Yale Group",               "hysteryale.wd1.myworkdayjobs.com"],
  ["Vanderlande",                     "vanderlande.wd3.myworkdayjobs.com"],
  ["AAON Inc",                        "aaon.wd108.myworkdayjobs.com"],
  ["Chamberlain Group",               "chamberlain.wd1.myworkdayjobs.com"],
  ["OmniOn Power",                    "omnionpower.wd5.myworkdayjobs.com"],
  ["KION Group",                      "kiongroup.wd3.myworkdayjobs.com"],
  ["thyssenkrupp Materials NA",       "thyssenkruppmaterialsna.wd12.myworkdayjobs.com"],
  ["TTM Technologies",                "ttmtech.wd5.myworkdayjobs.com"],
  ["Jabil",                           "jabil.wd5.myworkdayjobs.com"],
  ["GlobalFoundries",                 "globalfoundries.wd1.myworkdayjobs.com"],
  ["Array Technologies",              "arraytechinc.wd5.myworkdayjobs.com"],
  ["Nextracker",                      "nextracker.wd5.myworkdayjobs.com"],
  ["ITW (Illinois Tool Works)",       "itw.wd5.myworkdayjobs.com"],
  ["TRUMPF",                          "trumpf.wd3.myworkdayjobs.com"],
  ["Schweitzer Engineering (SEL)",    "selinc.wd1.myworkdayjobs.com"],
  ["Topcon Positioning Systems",      "topcon.wd1.myworkdayjobs.com"],
  ["SHI International",               "shi.wd12.myworkdayjobs.com"],
  ["Genuine Parts Company",           "genpt.wd1.myworkdayjobs.com"],
  ["Draper",                          "draper.wd5.myworkdayjobs.com"],
  ["Porch Group",                     "porch.wd1.myworkdayjobs.com"],
  ["Itron",                           "itron.wd5.myworkdayjobs.com"],
  ["ZEISS Group",                     "zeissgroup.wd3.myworkdayjobs.com"],
  ["Michelin",                        "michelinhr.wd3.myworkdayjobs.com"],

  // ── AUTOMOTIVE & TRANSPORTATION ──────────────────────────────────────────
  ["General Motors",                  "generalmotors.wd5.myworkdayjobs.com"],
  ["Toyota",                          "toyota.wd503.myworkdayjobs.com"],
  ["Magna International",             "magna.wd3.myworkdayjobs.com"],
  ["Aptiv",                           "aptiv.wd5.myworkdayjobs.com"],
  ["Manulife / John Hancock",         "manulife.wd3.myworkdayjobs.com"],
  ["Swift Transportation",            "swift.wd3.myworkdayjobs.com"],
  ["OPENLANE (formerly ADESA/KAR)",   "openlane.wd115.myworkdayjobs.com"],
  ["U-Haul",                          "uhaul.wd1.myworkdayjobs.com"],

  // ── ENERGY & UTILITIES ───────────────────────────────────────────────────
  ["Carrier Global",                  "carrier.wd5.myworkdayjobs.com"],
  ["American Electric Power",         "aep.wd1.myworkdayjobs.com"],
  ["CF Industries",                   "cfindustries.wd1.myworkdayjobs.com"],
  ["Marathon Petroleum",              "mpc.wd1.myworkdayjobs.com"],
  ["ERCOT",                           "ercot.wd1.myworkdayjobs.com"],
  ["IGS Energy",                      "igsenergy.wd1.myworkdayjobs.com"],
  ["Johnson Controls",                "jci.wd5.myworkdayjobs.com"],

  // ── AEROSPACE & DEFENSE ──────────────────────────────────────────────────
  ["Boeing",                          "boeing.wd1.myworkdayjobs.com"],
  ["Northrop Grumman",                "ngc.wd1.myworkdayjobs.com"],
  ["RTX (Raytheon Technologies)",     "globalhr.wd5.myworkdayjobs.com"],
  ["Leidos",                          "leidos.wd5.myworkdayjobs.com"],
  ["CACI International",              "caci.wd1.myworkdayjobs.com"],
  ["Booz Allen Hamilton",             "bah.wd1.myworkdayjobs.com"],
  ["KBR",                             "kbr.wd5.myworkdayjobs.com"],
  ["PAE",                             "pae.wd1.myworkdayjobs.com"],
  ["Parsons Corporation",             "parsons.wd5.myworkdayjobs.com"],
  ["Teledyne / FLIR",                 "flir.wd1.myworkdayjobs.com"],
  ["AeroVironment",                   "avav.wd1.myworkdayjobs.com"],
  ["Maxar Technologies",              "maxar.wd1.myworkdayjobs.com"],
  ["Blue Origin",                     "blueorigin.wd5.myworkdayjobs.com"],
  ["Boston Dynamics",                 "bostondynamics.wd1.myworkdayjobs.com"],
  ["Sierra Space",                    "sierraspace.wd1.myworkdayjobs.com"],
  ["Sierra Nevada Corporation",       "snc.wd1.myworkdayjobs.com"],
  ["Wisk Aero",                       "wisk.wd108.myworkdayjobs.com"],
  ["Insitu (Boeing subsidiary)",      "insitu.wd1.myworkdayjobs.com"],
  ["Rolls-Royce",                     "rollsroyce.wd3.myworkdayjobs.com"],
  ["Radiance Technologies",           "radiancetech.wd12.myworkdayjobs.com"],
  ["GDIT (General Dynamics IT)",      "gdit.wd5.myworkdayjobs.com"],
  ["Amentum / Nightwing",             "nwis.wd12.myworkdayjobs.com"],
  ["Torch Technologies",              "starfish.wd501.myworkdayjobs.com"],

  // ── PROFESSIONAL SERVICES & CONSULTING ───────────────────────────────────
  ["Accenture",                       "accenture.wd103.myworkdayjobs.com"],
  ["PwC",                             "pwc.wd3.myworkdayjobs.com"],
  ["Deloitte",                        "deloitte.wd5.myworkdayjobs.com"],
  ["ICF International",               "icf.wd5.myworkdayjobs.com"],
  ["Bonterra",                        "bonterra.wd1.myworkdayjobs.com"],
  ["SLR Consulting",                  "slrconsulting.wd103.myworkdayjobs.com"],
  ["Community Brands",                "communitybrands.wd1.myworkdayjobs.com"],

  // ── MEDIA, ENTERTAINMENT & TELECOM ───────────────────────────────────────
  ["Walt Disney Company",             "disney.wd5.myworkdayjobs.com"],
  ["Warner Bros Discovery",           "warnerbros.wd5.myworkdayjobs.com"],
  ["Comcast",                         "comcast.wd5.myworkdayjobs.com"],
  ["AT&T",                            "att.wd1.myworkdayjobs.com"],
  ["Verizon",                         "verizon.wd12.myworkdayjobs.com"],
  ["T-Mobile",                        "tmobile.wd1.myworkdayjobs.com"],
  ["Cox Enterprises",                 "cox.wd1.myworkdayjobs.com"],
  ["Condé Nast",                      "condenast.wd5.myworkdayjobs.com"],
  ["Dotdash Meredith",                "meredith.wd5.myworkdayjobs.com"],
  ["GN Group",                        "gn.wd3.myworkdayjobs.com"],
  ["The Heritage Group",              "thgrp.wd12.myworkdayjobs.com"],
  ["Relativity (kCura)",              "kcura.wd1.myworkdayjobs.com"],

  // ── OTHER / EDUCATION / PUBLIC SECTOR ────────────────────────────────────
  ["Southwest Airlines",              "swa.wd1.myworkdayjobs.com"],
  ["Western Union",                   "westernunion.wd5.myworkdayjobs.com"],
  ["Equinix",                         "equinix.wd1.myworkdayjobs.com"],
  ["ASML",                            "asml.wd3.myworkdayjobs.com"],
  ["CAE",                             "cae.wd3.myworkdayjobs.com"],
  ["Thales",                          "thales.wd3.myworkdayjobs.com"],
  ["Kapsch",                          "kapsch.wd3.myworkdayjobs.com"],
  ["Maersk (US)",                     "maersk.wd3.myworkdayjobs.com"],
  ["Ascensus",                        "ascensushr.wd1.myworkdayjobs.com"],
  ["Elekta",                          "elekta.wd3.myworkdayjobs.com"],
  ["BECU",                            "becu.wd1.myworkdayjobs.com"],
  ["Argonne National Laboratory",     "argonne.wd1.myworkdayjobs.com"],
  ["UCAR",                            "ucar.wd5.myworkdayjobs.com"],
  ["University of Texas Austin",      "utaustin.wd1.myworkdayjobs.com"],
  ["University of Southern California","usc.wd5.myworkdayjobs.com"],
  ["Carnegie Mellon University",      "cmu.wd5.myworkdayjobs.com"],
  ["Rochester Institute of Technology","rit.wd12.myworkdayjobs.com"],
  ["Universities of Wisconsin",       "wisconsin.wd1.myworkdayjobs.com"],
  ["State of Oregon",                 "oregon.wd5.myworkdayjobs.com"],
  ["City of Austin TX",               "austintexas.wd5.myworkdayjobs.com"],
  ["City of Charlotte NC",            "charlottenc.wd12.myworkdayjobs.com"],
  ["State of North Carolina",         "nc.wd108.myworkdayjobs.com"],
  ["College Board",                   "collegeboard.wd1.myworkdayjobs.com"],
  ["CFA Institute",                   "osv_cfainstitute.wd5.myworkdayjobs.com"],
  ["Simons Foundation",               "simonsfoundation.wd1.myworkdayjobs.com"],
  ["Compassion International",        "compassion.wd5.myworkdayjobs.com"],
  ["Boys Town",                       "boystown.wd1.myworkdayjobs.com"],
  ["GEICO",                           "geico.wd1.myworkdayjobs.com"],
  ["M&T Bank",                        "mtb.wd5.myworkdayjobs.com"],
  ["Element Fleet Management",        "elementfleet.wd3.myworkdayjobs.com"],
  ["O.C. Tanner",                     "octanner.wd501.myworkdayjobs.com"],
  ["Harris Computer",                 "harriscomputer.wd3.myworkdayjobs.com"],
  ["Alliantgroup",                    "alliantgroup.wd1.myworkdayjobs.com"],
  ["CGG",                             "cgg.wd103.myworkdayjobs.com"],
  ["Canvas Inc",                      "canvasinc.wd108.myworkdayjobs.com"],
  ["Verily (Alphabet)",               "verily.wd1.myworkdayjobs.com"],
  ["23andMe",                         "23andme.wd5.myworkdayjobs.com"],
  ["Altera (Intel spin-off)",         "altera.wd1.myworkdayjobs.com"],
  ["Amplify Education",               "amplify.wd1.myworkdayjobs.com"],
  ["Cengage Group",                   "cengage.wd5.myworkdayjobs.com"],
  ["BigCommerce",                     "bigcommerce.wd12.myworkdayjobs.com"],
  ["GooseHead Insurance",             "goosehead.wd503.myworkdayjobs.com"],
  ["OPENLANE",                        "openlane.wd115.myworkdayjobs.com"],
  ["Waystar",                         "waystar.wd1.myworkdayjobs.com"],
  ["CLEAResult",                      "clearesult.wd1.myworkdayjobs.com"],
  ["Cambium Learning Group",          "cambiumlearning.wd1.myworkdayjobs.com"],
  ["Ministry Brands",                 "ministrybrands.wd1.myworkdayjobs.com"],
  ["Cast & Crew",                     "castandcrew.wd503.myworkdayjobs.com"],
  ["Hendrick Motorsports",            "hendrick.wd5.myworkdayjobs.com"],
  ["ORION Advisor Solutions",         "orionadvisor.wd1.myworkdayjobs.com"],
  ["NCR SBM / SBM Offshore",         "sbmmanagement.wd108.myworkdayjobs.com"],
  ["Green Dot Corporation",           "greendotcorp.wd1.myworkdayjobs.com"],
  ["Lower.com",                       "lower.wd1.myworkdayjobs.com"],
  ["Tokio Marine HCC",                "tmhcc.wd108.myworkdayjobs.com"],
  ["Tokio Marine NA",                 "tmnas.wd5.myworkdayjobs.com"],
  ["Western Governors University",    "wgu.wd5.myworkdayjobs.com"],
  ["AAA",                             "ace.wd5.myworkdayjobs.com"],
  ["Arlo Technologies",               "arlo.wd12.myworkdayjobs.com"],
  ["Barry-Wehmiller",                 "barrywehmiller.wd1.myworkdayjobs.com"],
  ["TBC Corporation",                 "tbc.wd12.myworkdayjobs.com"],
  ["Becklar",                         "becklar.wd108.myworkdayjobs.com"],
  ["Premier Research",                "premierresearch.wd12.myworkdayjobs.com"],
  ["CGI / NSM Insurance",             "nsminc.wd1.myworkdayjobs.com"],
  ["OneMain Financial",               "myhrhome.wd1.myworkdayjobs.com"],
  ["Nelnet",                          "nelnet.wd1.myworkdayjobs.com"],
  ["Fullsteam",                       "fullsteam.wd1.myworkdayjobs.com"],
  ["World Finance",                   "worldacceptance.wd12.myworkdayjobs.com"],
  ["Signify (Philips Lighting)",      "lighting.wd3.myworkdayjobs.com"],
  ["Trimble Inc",                     "trimble.wd1.myworkdayjobs.com"],
  ["GoodRx",                          "goodrx.wd1.myworkdayjobs.com"],
  ["Aerospace Corporation",           "aero.wd5.myworkdayjobs.com"],
  ["Morningstar",                     "morningstar.wd5.myworkdayjobs.com"],
  ["S&P Global Mobility",             "mobility.wd503.myworkdayjobs.com"],
  ["TSC Stores",                      "tsc.wd12.myworkdayjobs.com"],
  ["Costar Group",                    "costar.wd1.myworkdayjobs.com"],
  ["Wonder",                          "wonder.wd1.myworkdayjobs.com"],
  ["Calista Corporation",             "calistacorp.wd1.myworkdayjobs.com"],
  ["Aptive Environmental",            "aptive.wd1.myworkdayjobs.com"],
  ["Aett / Versent",                  "aett.wd3.myworkdayjobs.com"],
  ["Symbolon",                        "mymoose.wd1.myworkdayjobs.com"],
];

// ── Deduplicate by host ────────────────────────────────────────────────────────
const seen = new Set();
const UNIQUE = COMPANIES.filter(([, host]) => {
  if (seen.has(host)) return false;
  seen.add(host);
  return true;
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function tenantFromHost(host) {
  return host.split(".")[0];
}

/**
 * Attempt to discover the Workday site slug by following the /en-US/ redirect.
 * Returns the slug string, or null if undiscoverable.
 */
async function discoverSiteSlug(host) {
  const urls = [
    `https://${host}/en-US/`,
    `https://${host}/`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        redirect: "follow",
        signal:   AbortSignal.timeout(TIMEOUT_MS),
        headers:  { "User-Agent": "JobRadar/0.1 (+https://local.jobradar)" },
      });
      const finalUrl = res.url;
      // Pattern: /en-US/{site} or /en-US/{site}/jobs or /en-US/{site}?...
      const m = finalUrl.match(/\/en-US\/([^\/\?#]+)/);
      if (m && m[1] && m[1].toLowerCase() !== "jobsearch" && m[1].toLowerCase() !== "search") {
        return m[1];
      }
    } catch { /* timeout / DNS / etc */ }
  }
  return null;
}

/** Quick API probe — returns { ok, total } */
async function probeApi(apiUrl) {
  try {
    const res = await fetch(apiUrl, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json",
                 "User-Agent": "JobRadar/0.1" },
      body:    JSON.stringify({ appliedFacets: {}, limit: 1, offset: 0, searchText: "" }),
      signal:  AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, status: res.status };
    const json = await res.json();
    return { ok: true, total: json.total ?? json.jobPostings?.length ?? 0 };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Process one company: discover site, probe API, upsert. */
async function processCompany([company, host]) {
  const tenant = tenantFromHost(host);

  process.stdout.write(`  ${company} (${host})… `);

  const site = await discoverSiteSlug(host);
  if (!site) {
    console.log("⚠️  could not discover site slug — skipping");
    return "skipped";
  }

  const apiUrl = `https://${host}/wday/cxs/${tenant}/${site}/jobs`;
  const probe  = await probeApi(apiUrl);

  if (!probe.ok) {
    console.log(`❌  ${probe.status ?? probe.error} (site=${site})`);
    return "failed";
  }

  console.log(`✅  ${probe.total} jobs  [site=${site}]`);

  if (DRY_RUN) return "dry-run";

  try {
    const url      = apiUrl;
    const existing = await prisma.jobSource.findUnique({ where: { url } });
    if (existing) {
      await prisma.jobSource.update({
        where: { url },
        data:  { company, provider: "WORKDAY", boardToken: tenant, enabled: true, updatedAt: new Date() },
      });
      return "updated";
    } else {
      await prisma.jobSource.create({
        data: { company, provider: "WORKDAY", boardToken: tenant, url, enabled: true, priority: 5, tags: "[]" },
      });
      return "created";
    }
  } catch (err) {
    console.error(`  ✗ DB error: ${err.message}`);
    return "db-error";
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const rows = LIMIT < Infinity ? UNIQUE.slice(0, LIMIT) : UNIQUE;
  console.log(`\n🔍  Workday discovery+seed: ${rows.length} unique hosts`);
  console.log(`    dry-run=${DRY_RUN}  concurrency=${CONCURRENCY}\n`);

  const stats = { created: 0, updated: 0, skipped: 0, failed: 0, "dry-run": 0, "db-error": 0 };

  // Process in batches of CONCURRENCY
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const batch   = rows.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(processCompany));
    results.forEach(r => stats[r] = (stats[r] ?? 0) + 1);
  }

  console.log("\n─────────────────────────────────────────────────────────────");
  console.log(`✅  created=${stats.created}  updated=${stats.updated}  skipped=${stats.skipped}  failed=${stats.failed}  dry-run=${stats["dry-run"]}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
