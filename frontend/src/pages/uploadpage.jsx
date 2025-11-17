"use client";

import { useState } from "react";
import Papa from "papaparse";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

export default function UploadData() {
  const [step, setStep] = useState(1);
  const [datasetType, setDatasetType] = useState(null);

  // raw files to send to backend
  const [csvFile, setCsvFile] = useState(null);
  const [geojsonFile, setGeojsonFile] = useState(null);

  // parsed data only for preview / checks
  const [csvData, setCsvData] = useState([]);
  const [geojsonData, setGeojsonData] = useState(null);

  const [csvFileInfo, setCsvFileInfo] = useState(null);
  const [geojsonFileInfo, setGeojsonFileInfo] = useState(null);

  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSelectDataset = (type) => {
    setDatasetType(type);
    setStep(2);
  };

  const handleCsvUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setCsvFile(file);
    setCsvFileInfo({ name: file.name, size: file.size });

    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (result) => {
        setCsvData(result.data || []);
      },
    });
  };

  const handleGeojsonUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setGeojsonFile(file);
    setGeojsonFileInfo({ name: file.name, size: file.size });

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target.result);
        setGeojsonData(json);
      } catch (error) {
        console.error("Invalid GeoJSON", error);
      }
    };

    reader.readAsText(file);
  };

  const handleConfirm = async () => {
    if (!csvFile || !geojsonFile || !datasetType) {
      alert("Missing file or dataset type.");
      return;
    }

    try {
      setIsSubmitting(true);

      const formData = new FormData();
      formData.append("datasetType", datasetType);
      formData.append("csv", csvFile);
      formData.append("geojson", geojsonFile);

      const res = await fetch("/api/upload-data", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        throw new Error("Upload failed");
      }

      const out = await res.json();
      console.log("Upload result:", out);
      alert("Upload successful");
    } catch (err) {
      console.error(err);
      alert("Something went wrong while uploading.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const hasAnyData =
    csvFile &&
    csvData &&
    csvData.length > 0 &&
    geojsonFile &&
    geojsonData &&
    Array.isArray(geojsonData.features) &&
    geojsonData.features.length > 0;

  return (
    <div className="w-full min-h-screen flex justify-center items-start p-8 bg-muted/40">
      <Card className="w-full max-w-4xl border border-slate-200 shadow-sm">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg font-semibold">
            Upload and Preview Data
          </CardTitle>

          {/* stepper */}
          <div className="mt-4 flex items-center gap-4 text-xs font-medium text-muted-foreground">
            {/* step 1 */}
            <div className="flex items-center gap-2">
              <div
                className={[
                  "flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium border",
                  step === 1
                    ? "bg-emerald-600 text-white border-emerald-600"
                    : step > 1
                    ? "bg-emerald-100 text-emerald-700 border-emerald-300"
                    : "bg-muted text-muted-foreground border-border",
                ].join(" ")}
              >
                1
              </div>
              <span>Select type</span>
            </div>

            <div className="h-px flex-1 bg-border" />

            {/* step 2 */}
            <div className="flex items-center gap-2">
              <div
                className={[
                  "flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium border",
                  step === 2
                    ? "bg-emerald-600 text-white border-emerald-600"
                    : step > 2
                    ? "bg-emerald-100 text-emerald-700 border-emerald-300"
                    : "bg-muted text-muted-foreground border-border",
                ].join(" ")}
              >
                2
              </div>
              <span>Upload & preview</span>
            </div>

            <div className="h-px flex-1 bg-border" />

            {/* step 3 */}
            <div className="flex items-center gap-2">
              <div
                className={[
                  "flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium border",
                  step === 3
                    ? "bg-emerald-600 text-white border-emerald-600"
                    : "bg-muted text-muted-foreground border-border",
                ].join(" ")}
              >
                3
              </div>
              <span>Confirm & upload</span>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-8 pt-2">
          {/* step 1: choose dataset type */}
          {step === 1 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Choose which dataset you are uploading now.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Button
                  type="button"
                  variant="outline"
                  className={`h-24 flex flex-col items-start justify-center border ${
                    datasetType === "amenities"
                      ? "border-emerald-500 bg-emerald-50"
                      : "border-slate-200 bg-background"
                  }`}
                  onClick={() => handleSelectDataset("amenities")}
                >
                  <span className="text-sm font-semibold">Amenities</span>
                  <span className="text-xs text-muted-foreground">
                    Upload amenities CSV and its matching GeoJSON.
                  </span>
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  className={`h-24 flex flex-col items-start justify-center border ${
                    datasetType === "flood"
                      ? "border-emerald-500 bg-emerald-50"
                      : "border-slate-200 bg-background"
                  }`}
                  onClick={() => handleSelectDataset("flood")}
                >
                  <span className="text-sm font-semibold">Flood</span>
                  <span className="text-xs text-muted-foreground">
                    Upload flood CSV and its matching GeoJSON.
                  </span>
                </Button>
              </div>
            </div>
          )}

          {/* step 2: upload + preview */}
          {step === 2 && (
            <div className="space-y-8">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">
                    Dataset type:{" "}
                    <span className="capitalize text-emerald-700">
                      {datasetType}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Upload the CSV and GeoJSON, then check the preview before
                    confirming.
                  </p>
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDatasetType(null);
                    setCsvData([]);
                    setGeojsonData(null);
                    setCsvFile(null);
                    setGeojsonFile(null);
                    setCsvFileInfo(null);
                    setGeojsonFileInfo(null);
                    setStep(1);
                  }}
                >
                  Change type
                </Button>
              </div>

              {/* CSV upload + preview */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">CSV file</span>
                </div>

                <Input type="file" accept=".csv" onChange={handleCsvUpload} />

                {csvFileInfo && (
                  <p className="text-xs text-muted-foreground">
                    <strong>{csvFileInfo.name}</strong>{" "}
                    ({(csvFileInfo.size / 1024).toFixed(2)} KB)
                  </p>
                )}

                {csvData && csvData.length > 0 && (
                  <div className="mt-2 rounded-md border bg-card">
                    <div className="flex items-center justify-between px-3 py-2 border-b">
                      <p className="text-xs font-semibold">
                        CSV preview ({csvData.length} rows)
                      </p>
                    </div>

                    {/* horizontal + vertical scroll, no overflow */}
                    <div className="w-full overflow-x-auto">
                      <ScrollArea className="max-h-72 min-w-max">
                        <table className="text-xs border-collapse min-w-max">
                          <thead>
                            <tr>
                              {Object.keys(csvData[0]).map((col) => (
                                <th
                                  key={col}
                                  className="border px-2 py-1 bg-muted text-left font-medium sticky top-0"
                                >
                                  <div className="max-w-[180px] truncate">
                                    {col}
                                  </div>
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {csvData.map((row, idx) => (
                              <tr
                                key={idx}
                                className="hover:bg-muted/40 align-top"
                              >
                                {Object.keys(csvData[0]).map((col) => (
                                  <td
                                    key={col}
                                    className="border px-2 py-1 align-top"
                                  >
                                    <div className="max-w-[180px] truncate">
                                      {row[col] !== null &&
                                      row[col] !== undefined
                                        ? String(row[col])
                                        : ""}
                                    </div>
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </ScrollArea>
                    </div>
                  </div>
                )}
              </div>

              {/* GeoJSON upload + preview */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">GeoJSON file</span>
                </div>

                <Input
                  type="file"
                  accept=".geojson,.json"
                  onChange={handleGeojsonUpload}
                />

                {geojsonFileInfo && (
                  <p className="text-xs text-muted-foreground">
                    <strong>{geojsonFileInfo.name}</strong>{" "}
                    ({(geojsonFileInfo.size / 1024).toFixed(2)} KB)
                  </p>
                )}

                {geojsonData && geojsonData.features && (
                  <div className="mt-2 rounded-md border bg-card">
                    <div className="flex items-center justify-between px-3 py-2 border-b">
                      <p className="text-xs font-semibold">
                        GeoJSON preview (features:{" "}
                        {geojsonData.features.length})
                      </p>
                    </div>

                    <div className="w-full overflow-x-auto">
                      <ScrollArea className="max-h-72 min-w-max">
                        {(() => {
                          const features = geojsonData.features || [];
                          const sampleProps =
                            features[0]?.properties || {};
                          const propKeys = Object.keys(sampleProps);

                          if (features.length === 0 || propKeys.length === 0) {
                            return (
                              <p className="text-xs text-muted-foreground px-3 py-2">
                                No properties found in features.
                              </p>
                            );
                          }

                          return (
                            <table className="text-xs border-collapse min-w-max">
                              <thead>
                                <tr>
                                  <th className="border px-2 py-1 bg-muted text-left font-medium sticky top-0">
                                    #
                                  </th>
                                  <th className="border px-2 py-1 bg-muted text-left font-medium sticky top-0">
                                    geometry_type
                                  </th>
                                  {propKeys.map((key) => (
                                    <th
                                      key={key}
                                      className="border px-2 py-1 bg-muted text-left font-medium sticky top-0"
                                    >
                                      <div className="max-w-[180px] truncate">
                                        {key}
                                      </div>
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {features.map((feat, idx) => (
                                  <tr
                                    key={idx}
                                    className="hover:bg-muted/40 align-top"
                                  >
                                    <td className="border px-2 py-1">
                                      {idx + 1}
                                    </td>
                                    <td className="border px-2 py-1">
                                      {feat.geometry?.type || ""}
                                    </td>
                                    {propKeys.map((key) => (
                                      <td
                                        key={key}
                                        className="border px-2 py-1 align-top"
                                      >
                                        <div className="max-w-[180px] truncate">
                                          {feat.properties &&
                                          feat.properties[key] !== undefined &&
                                          feat.properties[key] !== null
                                            ? String(feat.properties[key])
                                            : ""}
                                        </div>
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          );
                        })()}
                      </ScrollArea>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep(1)}
                >
                  Back
                </Button>
                <Button
                  type="button"
                  className="bg-emerald-600 hover:bg-emerald-700"
                  disabled={!hasAnyData}
                  onClick={() => setStep(3)}
                >
                  Continue to confirm
                </Button>
              </div>
            </div>
          )}

          {/* step 3: confirm + upload raw files */}
          {step === 3 && (
            <div className="space-y-6">
              <div>
                <p className="text-sm font-medium">
                  Ready to upload these files?
                </p>
                <p className="text-xs text-muted-foreground">
                  This will send the raw CSV and GeoJSON files to the backend,
                  while the previews stay only on the frontend.
                </p>
              </div>

              <div className="rounded-md border bg-card px-3 py-2 text-xs text-muted-foreground">
                <p>
                  <span className="font-semibold">Dataset type:</span>{" "}
                  <span className="capitalize">{datasetType}</span>
                </p>
                <p>
                  <span className="font-semibold">CSV rows (preview):</span>{" "}
                  {csvData?.length || 0}
                </p>
                <p>
                  <span className="font-semibold">
                    GeoJSON features (preview):
                  </span>{" "}
                  {geojsonData?.features?.length || 0}
                </p>
              </div>

              <div className="flex items-center justify-between">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep(2)}
                >
                  Back to preview
                </Button>
                <Button
                  type="button"
                  className="bg-emerald-600 hover:bg-emerald-700"
                  disabled={!hasAnyData || isSubmitting}
                  onClick={handleConfirm}
                >
                  {isSubmitting ? "Uploading..." : "Confirm & upload files"}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
