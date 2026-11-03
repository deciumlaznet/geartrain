// The three fake clients. Names, numbers and people are invented; company
// numbers use the 99 prefix and VAT numbers the GB999 prefix so they cannot be
// mistaken for real registrations.

import type { ClientProfile } from "./model.ts";

export interface RecurringSupplier {
  name: string;
  category: string;
  accountCode: string;
  monthlyNetPence: number;
  vatable: boolean;
  dayOfMonth: number;
  /** Month index (0 = first generated month) from which the cost starts. */
  fromMonth?: number;
}

export interface VariableSpend {
  category: string;
  accountCode: string;
  suppliers: string[];
  /** Net spend per month, as a share of that month's sales. */
  shareOfSales: number;
  vatable: boolean;
  viaPurchaseOrder?: boolean;
}

export interface ClientPlan {
  profile: ClientProfile;
  seed: number;
  /** Net sales per month in pence, before randomness, by month index. */
  monthlySales: (i: number, month: string) => number;
  averageInvoicePence: number;
  customerCount: number;
  salesAccountCode: string;
  salesDescriptions: string[];
  recurring: RecurringSupplier[];
  variable: VariableSpend[];
  vat: { mode: "fromStart"; registeredOn: string } | { mode: "whenThresholdCrossed" } | { mode: "never" };
  /** Headcount on payroll (including directors on payroll) by month index; sole traders have none. */
  headcount?: (i: number) => number;
  salaryBandsPence?: { role: string; min: number; max: number; weight: number }[];
  directors?: { name: string; salaryPence: number }[];
  owner: { name: string; monthlyDrawingsPence?: number; quarterlyDividendPence?: (i: number) => number };
  propertyIncomeMonthlyPence?: number;
  /** Business bank balance on the first generated day. */
  openingBankBalancePence: number;
}

const GBP = 100;

export const fenwick: ClientPlan = {
  seed: 1101,
  profile: {
    key: "fenwick",
    clientName: "Fenwick Garden Design",
    entity: {
      name: "Sam Okafor trading as Fenwick Garden Design",
      legalForm: "soleTrader",
      utr: "9900011223",
      financialYearEnd: "04-05",
      nations: ["england"],
      sectors: ["general"],
      activities: ["propertyIncome", "vehicles"],
      registeredOffice: "14 Larch Row, Kendal LA9 0ZZ",
    },
    people: [{ name: "Sam Okafor", role: "Owner", email: "sam@fenwick-garden.example" }],
  },
  // About £38k in 2022-23 growing to about £60k by 2025-26: crosses the £50k
  // MTD for Income Tax test on 2024-25 income.
  monthlySales: (i, month) => {
    const seasonal = [0.6, 0.7, 1.0, 1.3, 1.4, 1.4, 1.3, 1.2, 1.0, 0.8, 0.6, 0.5][Number(month.slice(5, 7)) - 1] ?? 1;
    return Math.round((3_100 * GBP + i * 55 * GBP) * seasonal);
  },
  averageInvoicePence: 850 * GBP,
  customerCount: 70,
  salesAccountCode: "200",
  salesDescriptions: ["Garden design consultation", "Planting scheme", "Landscape works", "Seasonal maintenance visit", "Patio and paving"],
  recurring: [
    { name: "Kestrel Mobile", category: "phone", accountCode: "489", monthlyNetPence: 32 * GBP, vatable: true, dayOfMonth: 3 },
    { name: "Driftwood Insurance Brokers", category: "insurance", accountCode: "433", monthlyNetPence: 46 * GBP, vatable: false, dayOfMonth: 1 },
    { name: "Planbox Software", category: "software", accountCode: "485", monthlyNetPence: 24 * GBP, vatable: true, dayOfMonth: 12 },
  ],
  variable: [
    { category: "plants and materials", accountCode: "310", suppliers: ["Greenway Nurseries", "Stoneacre Aggregates", "Mill Lane Timber"], shareOfSales: 0.24, vatable: true },
    { category: "fuel", accountCode: "449", suppliers: ["Northway Fuel"], shareOfSales: 0.05, vatable: true },
    { category: "tools", accountCode: "473", suppliers: ["Hollins Tool Hire"], shareOfSales: 0.03, vatable: true },
  ],
  vat: { mode: "never" },
  owner: { name: "Sam Okafor", monthlyDrawingsPence: 1_900 * GBP },
  propertyIncomeMonthlyPence: 725 * GBP,
  openingBankBalancePence: 4_000 * GBP,
};

export const copperleaf: ClientPlan = {
  seed: 2202,
  profile: {
    key: "copperleaf",
    clientName: "Copperleaf Studio",
    entity: {
      name: "Copperleaf Studio Ltd",
      legalForm: "ltd",
      companyNumber: "99456123",
      utr: "9900045612",
      incorporationDate: "2022-01-10",
      financialYearEnd: "12-31",
      nations: ["scotland"],
      sectors: ["general"],
      activities: ["takesCards", "euCustomers"],
      registeredOffice: "3 Quarrier Lane, Glasgow G2 9ZZ",
    },
    people: [
      { name: "Priya Lindqvist", role: "Director", email: "priya@copperleaf.example" },
      { name: "Tom Achebe", role: "Director", email: "tom@copperleaf.example" },
    ],
  },
  // A design studio growing past the VAT threshold (then £85k) in 2023.
  monthlySales: (i) => Math.round(5_500 * GBP + i * 210 * GBP),
  averageInvoicePence: 2_400 * GBP,
  customerCount: 28,
  salesAccountCode: "200",
  salesDescriptions: ["Brand identity project", "Website design", "Retainer: design support", "Packaging design", "Illustration commission"],
  recurring: [
    { name: "Quarrier Workspace", category: "rent", accountCode: "469", monthlyNetPence: 650 * GBP, vatable: true, dayOfMonth: 1 },
    { name: "Pixelforge Cloud", category: "software", accountCode: "485", monthlyNetPence: 140 * GBP, vatable: true, dayOfMonth: 5 },
    { name: "Clearline Broadband", category: "internet", accountCode: "489", monthlyNetPence: 45 * GBP, vatable: true, dayOfMonth: 9 },
    { name: "Bramble & Co Accountants", category: "accountancy", accountCode: "412", monthlyNetPence: 120 * GBP, vatable: true, dayOfMonth: 20 },
  ],
  variable: [
    { category: "freelancers", accountCode: "320", suppliers: ["Ola Mensah Illustration", "Fern Ridley Copywriting", "Kai Doherty Motion"], shareOfSales: 0.18, vatable: false },
    { category: "printing", accountCode: "310", suppliers: ["Inkwell Print Works"], shareOfSales: 0.04, vatable: true },
    { category: "travel", accountCode: "493", suppliers: ["Railway Booking Services"], shareOfSales: 0.015, vatable: false },
  ],
  vat: { mode: "whenThresholdCrossed" },
  headcount: (i) => (i < 20 ? 2 : i < 42 ? 3 : 4),
  salaryBandsPence: [{ role: "Designer", min: 27_000 * GBP, max: 34_000 * GBP, weight: 1 }],
  directors: [
    { name: "Priya Lindqvist", salaryPence: 12_570 * GBP },
    { name: "Tom Achebe", salaryPence: 12_570 * GBP },
  ],
  openingBankBalancePence: 22_000 * GBP,
  owner: { name: "Priya Lindqvist", quarterlyDividendPence: (i) => (i < 12 ? 2_500 * GBP : 4_000 * GBP) },
};

export const northgate: ClientPlan = {
  seed: 3303,
  profile: {
    key: "northgate",
    clientName: "Northgate Precision",
    entity: {
      name: "Northgate Precision Engineering Ltd",
      legalForm: "ltd",
      companyNumber: "99781244",
      utr: "9900078124",
      vatNumber: "GB999781244",
      incorporationDate: "2021-09-01",
      financialYearEnd: "03-31",
      nations: ["england", "wales"],
      sectors: ["general"],
      activities: ["importsGoods", "exportsGoods", "premises", "vehicles", "offersCredit"],
      registeredOffice: "Unit 7, Foundry Park, Wrexham LL13 0ZZ",
    },
    people: [
      { name: "Gareth Pryce", role: "Managing director", email: "gareth@northgate-precision.example" },
      { name: "Hannah Voss", role: "Finance director", email: "hannah@northgate-precision.example" },
    ],
  },
  // CNC machining: about £0.9m in 2022-23 growing to about £3.5m a year.
  monthlySales: (i) => Math.round(72_000 * GBP * Math.pow(1.03, i)),
  averageInvoicePence: 6_500 * GBP,
  customerCount: 45,
  salesAccountCode: "200",
  salesDescriptions: ["CNC machined parts", "Prototype batch", "Production run", "Tooling and fixtures", "Inspection and certification"],
  recurring: [
    { name: "Foundry Park Estates", category: "rent", accountCode: "469", monthlyNetPence: 4_200 * GBP, vatable: true, dayOfMonth: 1 },
    { name: "Ridgeline Energy", category: "power", accountCode: "445", monthlyNetPence: 2_600 * GBP, vatable: true, dayOfMonth: 14 },
    { name: "Anvil Mutual Insurance", category: "insurance", accountCode: "433", monthlyNetPence: 900 * GBP, vatable: false, dayOfMonth: 2 },
    { name: "Steelhead ERP", category: "software", accountCode: "485", monthlyNetPence: 380 * GBP, vatable: true, dayOfMonth: 6 },
    { name: "Tidewell Pensions", category: "pension provider", accountCode: "478", monthlyNetPence: 0, vatable: false, dayOfMonth: 15 },
  ],
  variable: [
    { category: "raw materials", accountCode: "310", suppliers: ["Calder Alloys", "Penrose Steel Stock", "Wyeside Plastics"], shareOfSales: 0.31, vatable: true, viaPurchaseOrder: true },
    { category: "tooling", accountCode: "311", suppliers: ["Sharpline Tooling", "Brecon Cutting Tools"], shareOfSales: 0.06, vatable: true, viaPurchaseOrder: true },
    { category: "carriage", accountCode: "425", suppliers: ["Marchway Logistics"], shareOfSales: 0.025, vatable: true },
    { category: "maintenance", accountCode: "473", suppliers: ["Deeside Machine Services"], shareOfSales: 0.02, vatable: true },
  ],
  vat: { mode: "fromStart", registeredOn: "2021-10-01" },
  // 3 staff in April 2022 to about 42 by October 2026, with a hiring pause in 2024.
  headcount: (i) => Math.round(i < 24 ? 3 + i * 0.7 : i < 30 ? 20 : 20 + (i - 30) * 0.9),
  salaryBandsPence: [
    { role: "Machinist", min: 26_000 * GBP, max: 34_000 * GBP, weight: 6 },
    { role: "Setter operator", min: 31_000 * GBP, max: 38_000 * GBP, weight: 3 },
    { role: "Quality inspector", min: 29_000 * GBP, max: 35_000 * GBP, weight: 1 },
    { role: "Apprentice", min: 15_000 * GBP, max: 19_000 * GBP, weight: 1 },
    { role: "Office administrator", min: 24_000 * GBP, max: 28_000 * GBP, weight: 1 },
  ],
  directors: [
    { name: "Gareth Pryce", salaryPence: 12_570 * GBP },
    { name: "Hannah Voss", salaryPence: 12_570 * GBP },
  ],
  openingBankBalancePence: 60_000 * GBP,
  owner: { name: "Gareth Pryce", quarterlyDividendPence: (i) => (i < 16 ? 9_000 * GBP : 15_000 * GBP) },
};

export const allPlans: ClientPlan[] = [fenwick, copperleaf, northgate];
