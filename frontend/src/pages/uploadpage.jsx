"use client";

import { useState } from "react";
import Papa from "papaparse";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function UploadData() {
  const [csvData, setCsvData] = useState(null);
  const [geojsonData, setGeojsonData] = useState(null);
  const [csvFileInfo, setCsvFileInfo] = useState(null);
  const [geojsonFileInfo, setGeojsonFileInfo] = useState(null);

  // Handle CSV Upload
  const handleCsvUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setCsvFileInfo({ name: file.name, size: file.size });

    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      complete: (result) => {
        setCsvData(result.data);
        console.log("CSV Parsed:", result.data);
      },
    });
  };

  // Handle GeoJSON Upload
  const handleGeojsonUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setGeojsonFileInfo({ name: file.name, size: file.size });

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target.result);
        setGeojsonData(json);
        console.log("GeoJSON Parsed:", json);
      } catch (error) {
        console.error("Invalid GeoJSON");
      }
    };

    reader.readAsText(file);
  };

  return (
    <div className="w-full min-h-screen flex justify-center items-start p-10">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle className="text-xl font-bold">
            Upload CSV or GeoJSON
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-6">

          {/* CSV Upload */}
          <div className="space-y-2">
            <label className="font-medium">Upload CSV</label>
            <Input type="file" accept=".csv" onChange={handleCsvUpload} />

            {csvFileInfo && (
              <p className="text-sm text-muted-foreground">
                <strong>{csvFileInfo.name}</strong> ({(csvFileInfo.size / 1024).toFixed(2)} KB)
              </p>
            )}
          </div>

          {/* GeoJSON Upload */}
          <div className="space-y-2">
            <label className="font-medium">Upload GeoJSON</label>
            <Input type="file" accept=".geojson,.json" onChange={handleGeojsonUpload} />

            {geojsonFileInfo && (
              <p className="text-sm text-muted-foreground">
                <strong>{geojsonFileInfo.name}</strong> ({(geojsonFileInfo.size / 1024).toFixed(2)} KB)
              </p>
            )}
          </div>

          {/* Data Preview */}
          <div className="space-y-2">
            {csvData && (
              <p className="text-sm text-green-600">
                ✓ CSV loaded ({csvData.length} rows)
              </p>
            )}
            {geojsonData && (
              <p className="text-sm text-blue-600">
                ✓ GeoJSON loaded (features: {geojsonData.features?.length})
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
