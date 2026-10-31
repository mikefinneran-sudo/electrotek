import "./licensing.css";
import type { ClientConfig } from "@waltersignal/bananaforce-core";
import {
  createLicenseAction,
  deleteLicenseDocumentAction,
  recordRenewalAction,
  updateLicenseAction,
  uploadLicenseDocument,
} from "./actions";
import { licenseExpiryAlerts, localDateString } from "./lifecycle";
import { listHolderOptions, listLicenseDetails, listLicenses } from "./server";
import { LicensesDashboard } from "./ui";

function groupBy<T extends { license_id: string }>(rows: T[]): Record<string, T[]> {
  const grouped: Record<string, T[]> = {};
  for (const row of rows) (grouped[row.license_id] ??= []).push(row);
  return grouped;
}

export function createLicensesPage(clientConfig: ClientConfig) {
  return async function LicensesPage() {
    // Firm-local date: status and "days left" do not roll over at UTC midnight.
    const now = localDateString();
    const [licenses, holders] = await Promise.all([listLicenses(now), listHolderOptions()]);
    const { renewals, documents } = await listLicenseDetails(licenses.map((license) => license.id));

    return (
      <LicensesDashboard
        title="Licenses"
        licenses={licenses}
        alerts={licenseExpiryAlerts(licenses)}
        holders={{ ...holders, companyName: holders.companyName ?? clientConfig.brand.name }}
        renewalsByLicenseId={groupBy(renewals)}
        documentsByLicenseId={groupBy(documents)}
        onCreateLicense={createLicenseAction}
        onUpdateLicense={updateLicenseAction}
        onRecordRenewal={recordRenewalAction}
        onUploadDocument={uploadLicenseDocument}
        onDeleteDocument={deleteLicenseDocumentAction}
      />
    );
  };
}
