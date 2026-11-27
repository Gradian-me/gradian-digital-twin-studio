import React, { useEffect, useMemo, useState } from 'react';
import { jsPDF } from 'jspdf';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Cpu,
  Download,
  FileText,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useTwinStore } from '../store/useTwinStore';
import { useGmpStore } from '../store/useGmpStore';
import { useTelemetryStore } from '../store/useTelemetryStore';
import { getRpnPriority, useRiskIncidentStore } from '../store/useRiskIncidentStore';
import { enrichAssetHistory } from '../data/cinnagenDemo';
import type { SpatialAsset } from '../types/twin';

export const AssetCompliancePdfModal: React.FC = () => {
  const isOpen = useRiskIncidentStore((s) => s.assetPdfModalOpen);
  const targetAssetId = useRiskIncidentStore((s) => s.assetPdfTargetId);
  const closeModal = useRiskIncidentStore((s) => s.closeAssetPdfModal);
  const incidents = useRiskIncidentStore((s) => s.incidents);

  const scene = useTwinStore((s) => s.scene);
  const selected = useTwinStore((s) => s.selected);
  const recordAudit = useTwinStore((s) => s.recordAudit);
  const showToast = useTwinStore((s) => s.showToast);

  const complianceByAssetId = useGmpStore((s) => s.complianceByAssetId);
  const getCompliance = useGmpStore((s) => s.getCompliance);
  const workOrders = useGmpStore((s) => s.workOrders);
  const sops = useGmpStore((s) => s.sops);
  const productionLines = useGmpStore((s) => s.productionLines);

  const sensors = useTelemetryStore((s) => s.sensors);
  const readings = useTelemetryStore((s) => s.readings);
  const fetchLiveSnapshot = useTelemetryStore((s) => s.fetchLiveSnapshot);
  const serverTime = useTelemetryStore((s) => s.serverTime);

  const [selectedAssetId, setSelectedAssetId] = useState<string>('');
  const [includeTelemetry, setIncludeTelemetry] = useState(true);
  const [includeGmpCycles, setIncludeGmpCycles] = useState(true);
  const [includeFmeaHistory, setIncludeFmeaHistory] = useState(true);
  const [includeSopsAndLines, setIncludeSopsAndLines] = useState(true);
  const [includeSignOff, setIncludeSignOff] = useState(true);
  const [reviewerName, setReviewerName] = useState('QA Compliance Officer');
  const [reportNotes, setReportNotes] = useState('');
  const [exporting, setExporting] = useState(false);

  // Sync default selected asset whenever modal opens
  useEffect(() => {
    if (!isOpen) return;
    if (targetAssetId && scene.assets.some((a) => a.id === targetAssetId)) {
      setSelectedAssetId(targetAssetId);
      return;
    }
    const selAsset = selected.find((s) => s.type === 'asset');
    if (selAsset && scene.assets.some((a) => a.id === selAsset.id)) {
      setSelectedAssetId(selAsset.id);
      return;
    }
    const gmpCritical =
      scene.assets.find((a) => a.criticality === 'gmp-critical') ?? scene.assets[0];
    if (gmpCritical) setSelectedAssetId(gmpCritical.id);
  }, [isOpen, targetAssetId, selected, scene.assets]);

  // Escape to close
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, closeModal]);

  const asset: SpatialAsset | null = useMemo(() => {
    const raw = scene.assets.find((a) => a.id === selectedAssetId) ?? scene.assets[0] ?? null;
    return raw ? enrichAssetHistory(raw) : null;
  }, [scene.assets, selectedAssetId]);

  const room = useMemo(
    () => (asset?.roomId ? scene.rooms.find((r) => r.id === asset.roomId) ?? null : null),
    [asset, scene.rooms]
  );

  const floor = useMemo(
    () => (asset ? scene.floors.find((f) => f.id === asset.floorId) ?? null : null),
    [asset, scene.floors]
  );

  const building = useMemo(
    () => (floor ? scene.buildings.find((b) => b.id === floor.buildingId) ?? null : null),
    [floor, scene.buildings]
  );

  // Ensure compliance record exists for the selected asset without mutating store during render
  useEffect(() => {
    if (!isOpen || !asset) return;
    if (!complianceByAssetId[asset.id]) {
      getCompliance(asset.id);
    }
  }, [isOpen, asset, complianceByAssetId, getCompliance]);

  const compliance = useMemo(() => {
    if (!asset) return null;
    return complianceByAssetId[asset.id] ?? null;
  }, [asset, complianceByAssetId]);

  // Related live telemetry sensors (direct asset sensors + hosting room sensors)
  const assetSensors = useMemo(() => {
    if (!asset) return [];
    const direct = sensors.filter(
      (s) => s.targetId === asset.id || s.targetCode === asset.assetId
    );
    const roomEnv = room
      ? sensors.filter((s) => s.targetId === room.id || s.targetCode === room.code)
      : [];
    const merged = [...direct, ...roomEnv];
    return Array.from(new Map(merged.map((s) => [s.id, s])).values());
  }, [asset, room, sensors]);

  // Asset + hosting room FMEA risk history
  const assetIncidents = useMemo(() => {
    if (!asset) return [];
    return incidents
      .filter(
        (inc) =>
          inc.targetId === asset.id ||
          inc.targetCode === asset.assetId ||
          (room && (inc.targetId === room.id || inc.roomId === room.id))
      )
      .sort((a, b) => b.rpn - a.rpn);
  }, [asset, room, incidents]);

  const relatedWorkOrders = useMemo(() => {
    if (!asset) return [];
    return workOrders.filter(
      (wo) => wo.targetId === asset.id || (room && wo.targetId === room.id)
    );
  }, [asset, room, workOrders]);

  const relatedSops = useMemo(() => {
    if (!asset) return [];
    const sopIdSet = new Set(asset.sopIds ?? []);
    return sops.filter(
      (s) =>
        sopIdSet.has(s.id) ||
        sopIdSet.has(s.docNumber) ||
        s.equipmentCategory === asset.category ||
        s.equipmentCategory === 'All Equipment' ||
        Boolean(s.archetypes?.includes(asset.archetype))
    );
  }, [asset, sops]);

  const relatedLines = useMemo(() => {
    if (!asset) return [];
    return productionLines.filter(
      (l) => l.assetIds.includes(asset.id) || (room && l.roomIds.includes(room.id))
    );
  }, [asset, room, productionLines]);

  const summary = useMemo(() => {
    const alarmSensors = assetSensors.filter((s) => readings[s.id]?.status === 'alarm').length;
    const warnSensors = assetSensors.filter((s) => readings[s.id]?.status === 'warning').length;
    const openRisks = assetIncidents.filter(
      (i) => i.status === 'open' || i.status === 'investigating'
    );
    const maxRpn = assetIncidents.reduce((m, i) => Math.max(m, i.rpn), 0);
    const maxSo = assetIncidents.reduce((m, i) => Math.max(m, i.severity * i.occurrence), 0);
    const overdueCycles = compliance
      ? [compliance.calibration.status, compliance.qualification.status, compliance.maintenance.status].filter(
          (st) => st === 'overdue'
        ).length
      : 0;
    const dueSoonCycles = compliance
      ? [compliance.calibration.status, compliance.qualification.status, compliance.maintenance.status].filter(
          (st) => st === 'due-soon'
        ).length
      : 0;
    const openWoCount = relatedWorkOrders.filter((w) => w.status !== 'completed').length;

    let overallStatus: 'COMPLIANT' | 'ATTENTION' | 'BLOCKED' = 'COMPLIANT';
    if (
      overdueCycles > 0 ||
      alarmSensors > 0 ||
      openRisks.some((r) => r.rpn >= 200) ||
      asset?.operationalStatus === 'offline'
    ) {
      overallStatus = 'BLOCKED';
    } else if (
      dueSoonCycles > 0 ||
      warnSensors > 0 ||
      openRisks.length > 0 ||
      asset?.operationalStatus === 'maintenance-due'
    ) {
      overallStatus = 'ATTENTION';
    }

    return {
      alarmSensors,
      warnSensors,
      nominalSensors: Math.max(0, assetSensors.length - alarmSensors - warnSensors),
      openRiskCount: openRisks.length,
      mitigatedRiskCount: assetIncidents.length - openRisks.length,
      maxRpn,
      maxSo,
      overdueCycles,
      dueSoonCycles,
      openWoCount,
      overallStatus,
    };
  }, [asset, assetSensors, readings, assetIncidents, compliance, relatedWorkOrders]);

  if (!isOpen || !asset) return null;

  const generatedIso = new Date().toISOString();
  const reportCode = `RPT-GMP-${asset.assetId.replace(/[^A-Z0-9]/gi, '')}-${generatedIso.slice(0, 10).replace(/-/g, '')}`;

  const handleDownloadPdf = () => {
    setExporting(true);
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const margin = 14;
      const contentW = pageW - margin * 2;
      let y = 16;

      const ensureSpace = (neededMm: number) => {
        if (y + neededMm > pageH - 18) {
          doc.addPage();
          y = 18;
        }
      };

      const drawSectionTitle = (label: string) => {
        ensureSpace(14);
        y += 3;
        doc.setFillColor(244, 244, 248);
        doc.roundedRect(margin, y, contentW, 7.5, 1.5, 1.5, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.setTextColor(30, 27, 75);
        doc.text(label.toUpperCase(), margin + 3, y + 5.2);
        y += 10.5;
      };

      // Top Executive Document Banner
      doc.setFillColor(17, 17, 24);
      doc.roundedRect(margin, y, contentW, 24, 2.5, 2.5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.setTextColor(255, 255, 255);
      doc.text('ASSET FMEA RISK & GMP COMPLIANCE REPORT', margin + 4, y + 8.5);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(212, 212, 216);
      doc.text(
        `${scene.name}  |  ${asset.assetId} — ${asset.name}`,
        margin + 4,
        y + 14.5
      );
      doc.text(
        `Report ID: ${reportCode}  |  Generated: ${new Date().toLocaleString()}  |  Telemetry Sync: ${serverTime || 'Live'}`,
        margin + 4,
        y + 20
      );
      y += 28;

      // Status KPI Strip (4 flat boxes)
      const kpiW = (contentW - 6) / 4;
      const kpis: { label: string; value: string; sub: string; rgb: [number, number, number] }[] = [
        {
          label: 'GMP STATUS',
          value: summary.overallStatus,
          sub: `${summary.overdueCycles} overdue · ${summary.dueSoonCycles} due soon`,
          rgb:
            summary.overallStatus === 'BLOCKED'
              ? [220, 38, 38]
              : summary.overallStatus === 'ATTENTION'
                ? [217, 119, 6]
                : [22, 163, 74],
        },
        {
          label: 'FMEA RISK',
          value: `RPN ${summary.maxRpn}`,
          sub: `Max S×O ${summary.maxSo} · ${summary.openRiskCount} open`,
          rgb: summary.maxRpn >= 200 ? [220, 38, 38] : summary.maxRpn >= 100 ? [217, 119, 6] : [109, 40, 217],
        },
        {
          label: 'LIVE TELEMETRY',
          value: `${assetSensors.length} Sensors`,
          sub: `${summary.alarmSensors} alarm · ${summary.warnSensors} warn`,
          rgb: summary.alarmSensors > 0 ? [220, 38, 38] : summary.warnSensors > 0 ? [217, 119, 6] : [22, 163, 74],
        },
        {
          label: 'ASSET HEALTH',
          value: `${asset.conditionScore}%`,
          sub: `${asset.operationalStatus.toUpperCase()} · ${summary.openWoCount} open WO`,
          rgb: [30, 41, 59],
        },
      ];

      kpis.forEach((k, idx) => {
        const bx = margin + idx * (kpiW + 2);
        doc.setDrawColor(226, 232, 240);
        doc.setFillColor(255, 255, 255);
        doc.roundedRect(bx, y, kpiW, 18, 1.8, 1.8, 'FD');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7);
        doc.setTextColor(100, 116, 139);
        doc.text(k.label, bx + 2.5, y + 4.8);
        doc.setFontSize(11);
        doc.setTextColor(k.rgb[0], k.rgb[1], k.rgb[2]);
        doc.text(k.value, bx + 2.5, y + 11.2);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.8);
        doc.setTextColor(100, 116, 139);
        doc.text(k.sub, bx + 2.5, y + 15.8);
      });
      y += 22;

      // Asset Identification Block
      drawSectionTitle('1. Asset Identification & Spatial Assignment');
      const idRows: [string, string, string, string][] = [
        ['Asset Tag / ID', asset.assetId, 'Category', asset.category],
        ['Equipment Name', asset.name, 'Criticality', asset.criticality.toUpperCase()],
        ['Manufacturer / Model', `${asset.manufacturer} · ${asset.model}`, 'Serial Number', asset.serialNumber],
        [
          'Facility Location',
          `${building?.code ?? 'Site'} / ${floor?.code ?? 'FL'} / ${room ? `${room.code} ${room.name}` : 'Unassigned'}`,
          'Cleanroom Grade',
          room?.environmental.cleanroomGrade ?? 'N/A',
        ],
        ['Owner / Dept', `${asset.owner} (${asset.department})`, 'Cost Center', asset.costCenter ?? 'CC-GMP-100'],
        [
          'Connectivity',
          `${asset.connectivity.protocol} · ${asset.connectivity.plcTag || asset.connectivity.scadaNode || 'Standalone'}`,
          'Power / Utilization',
          `${asset.energyKw} kW · ${asset.utilizationPct}%`,
        ],
      ];

      doc.setFontSize(8);
      idRows.forEach(([k1, v1, k2, v2]) => {
        ensureSpace(6);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(100, 116, 139);
        doc.text(`${k1}:`, margin + 1, y);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(15, 23, 42);
        doc.text(String(v1).slice(0, 44), margin + 33, y);

        doc.setFont('helvetica', 'bold');
        doc.setTextColor(100, 116, 139);
        doc.text(`${k2}:`, margin + 96, y);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(15, 23, 42);
        doc.text(String(v2).slice(0, 36), margin + 124, y);
        y += 5.4;
      });

      // Section 2: Live Telemetry Snapshot
      if (includeTelemetry) {
        drawSectionTitle('2. Live Telemetry Snapshot & Operating Limits');
        if (assetSensors.length === 0 && asset.connectivity.liveMetrics.length === 0) {
          doc.setFont('helvetica', 'italic');
          doc.setFontSize(8);
          doc.setTextColor(100, 116, 139);
          doc.text('No live telemetry sensors bound directly to this asset or its hosting room.', margin + 1, y);
          y += 6;
        } else {
          // Table Header
          ensureSpace(10);
          doc.setFillColor(248, 250, 252);
          doc.rect(margin, y - 3.5, contentW, 5.5, 'F');
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(7.5);
          doc.setTextColor(71, 85, 105);
          doc.text('Sensor Tag', margin + 1.5, y);
          doc.text('Parameter / Scope', margin + 36, y);
          doc.text('Live Reading', margin + 98, y);
          doc.text('Nominal', margin + 125, y);
          doc.text('Alarm Limits', margin + 145, y);
          doc.text('Status', margin + 170, y);
          y += 5;

          assetSensors.forEach((sn) => {
            ensureSpace(6);
            const snap = readings[sn.id];
            const val = snap ? `${snap.value.toFixed(2)} ${sn.unit}` : `${sn.nominal} ${sn.unit}`;
            const st = (snap?.status ?? 'nominal').toUpperCase();
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7.8);
            doc.setTextColor(15, 23, 42);
            doc.text(sn.tag.slice(0, 22), margin + 1.5, y);
            doc.text(`${sn.name} (${sn.targetCode})`.slice(0, 34), margin + 36, y);
            doc.setFont('helvetica', 'bold');
            doc.text(val, margin + 98, y);
            doc.setFont('helvetica', 'normal');
            doc.text(`${sn.nominal} ${sn.unit}`, margin + 125, y);
            doc.text(`${sn.alarmLow}–${sn.alarmHigh}`, margin + 145, y);
            doc.setFont('helvetica', 'bold');
            if (st === 'ALARM') doc.setTextColor(220, 38, 38);
            else if (st === 'WARNING') doc.setTextColor(217, 119, 6);
            else doc.setTextColor(22, 163, 74);
            doc.text(st, margin + 170, y);
            y += 5.2;
          });

          if (asset.connectivity.liveMetrics.length > 0) {
            y += 1.5;
            asset.connectivity.liveMetrics.forEach((m) => {
              ensureSpace(5.5);
              doc.setFont('helvetica', 'normal');
              doc.setFontSize(7.5);
              doc.setTextColor(71, 85, 105);
              doc.text(
                `SCADA / PLC Metric: ${m.label} = ${m.value} ${m.unit}  [${m.status.toUpperCase()}]`,
                margin + 1.5,
                y
              );
              y += 4.6;
            });
          }
        }
      }

      // Section 3: GMP Compliance Cycles & Lifecycle Status
      if (includeGmpCycles && compliance) {
        drawSectionTitle('3. GMP Compliance, Calibration & Qualification Status');
        const cycles = [
          { name: 'Calibration', rec: compliance.calibration },
          { name: `Qualification (${compliance.qualification.stage})`, rec: compliance.qualification },
          { name: 'Preventive Maintenance', rec: compliance.maintenance },
        ];

        ensureSpace(10);
        doc.setFillColor(248, 250, 252);
        doc.rect(margin, y - 3.5, contentW, 5.5, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(71, 85, 105);
        doc.text('GMP Cycle', margin + 1.5, y);
        doc.text('Status', margin + 44, y);
        doc.text('Last Service', margin + 68, y);
        doc.text('Next Due', margin + 94, y);
        doc.text('Protocol / Cert', margin + 118, y);
        doc.text('Performed By', margin + 154, y);
        y += 5;

        cycles.forEach(({ name, rec }) => {
          ensureSpace(6);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7.8);
          doc.setTextColor(15, 23, 42);
          doc.text(name, margin + 1.5, y);
          doc.setFont('helvetica', 'bold');
          if (rec.status === 'overdue') doc.setTextColor(220, 38, 38);
          else if (rec.status === 'due-soon') doc.setTextColor(217, 119, 6);
          else doc.setTextColor(22, 163, 74);
          doc.text(rec.status.toUpperCase(), margin + 44, y);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(15, 23, 42);
          doc.text(rec.lastDate, margin + 68, y);
          doc.text(rec.nextDueDate, margin + 94, y);
          doc.text(rec.certificateOrProtocol.slice(0, 20), margin + 118, y);
          doc.text(rec.performedBy.slice(0, 18), margin + 154, y);
          y += 5.4;
        });

        if (compliance.lifecycleEvents.length > 0) {
          y += 2;
          ensureSpace(10);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(8);
          doc.setTextColor(51, 65, 85);
          doc.text('Recent GMP Lifecycle Events:', margin + 1.5, y);
          y += 4.8;
          compliance.lifecycleEvents.slice(0, 5).forEach((ev) => {
            ensureSpace(6);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7.6);
            doc.setTextColor(30, 41, 59);
            const line = `${ev.date}  [${ev.outcome.toUpperCase()}]  ${ev.title} — ${ev.performedBy}${ev.referenceDoc ? ` (${ev.referenceDoc})` : ''}`;
            const wrapped = doc.splitTextToSize(line, contentW - 4);
            doc.text(wrapped, margin + 2, y);
            y += wrapped.length * 4.2 + 0.8;
          });
        }
      }

      // Section 4: FMEA Risk History & CAPA Register
      if (includeFmeaHistory) {
        drawSectionTitle('4. FMEA Risk History, Failure Modes & CAPA Summary');
        if (assetIncidents.length === 0) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8);
          doc.setTextColor(22, 163, 74);
          doc.text('No open or historical FMEA risk incidents recorded for this asset or its hosting room.', margin + 1.5, y);
          y += 6;
        } else {
          assetIncidents.forEach((inc) => {
            ensureSpace(22);
            const so = inc.severity * inc.occurrence;
            const prio = getRpnPriority(inc.rpn);

            doc.setDrawColor(226, 232, 240);
            doc.setFillColor(252, 252, 254);
            doc.roundedRect(margin, y - 3, contentW, 20, 1.5, 1.5, 'FD');

            doc.setFont('helvetica', 'bold');
            doc.setFontSize(8.2);
            doc.setTextColor(15, 23, 42);
            doc.text(`${inc.code}  |  ${inc.title}`.slice(0, 74), margin + 2.5, y + 1.2);

            doc.setFontSize(8);
            if (inc.rpn >= 200) doc.setTextColor(220, 38, 38);
            else if (inc.rpn >= 100) doc.setTextColor(217, 119, 6);
            else doc.setTextColor(22, 163, 74);
            doc.text(
              `RPN ${inc.rpn} (${prio.label})  S×O=${so}`,
              pageW - margin - 2.5,
              y + 1.2,
              { align: 'right' }
            );

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7.4);
            doc.setTextColor(71, 85, 105);
            doc.text(
              `Status: ${inc.status.toUpperCase()}  |  Scores: S:${inc.severity} × O:${inc.occurrence} × D:${inc.detection} (Initial RPN ${inc.initialRpn})  |  Owner: ${inc.owner}`,
              margin + 2.5,
              y + 6
            );
            const fmLine = doc.splitTextToSize(
              `Failure Mode: ${inc.failureMode}  |  Cause: ${inc.cause}`,
              contentW - 5
            );
            doc.text(fmLine.slice(0, 2), margin + 2.5, y + 10.2);

            const capaNote = inc.aiResolution
              ? `CAPA Plan (${inc.linkedWorkOrderId ?? 'Draft'}): ${inc.aiResolution.summary.slice(0, 95)} (Residual RPN ${inc.aiResolution.residualRpn})`
              : `Controls: ${inc.currentControls.slice(0, 100)}`;
            doc.setTextColor(51, 65, 85);
            doc.text(capaNote, margin + 2.5, y + 15.2);
            y += 22.5;
          });
        }
      }

      // Section 5: SOPs, Work Orders & Production Lines
      if (includeSopsAndLines) {
        drawSectionTitle('5. Controlled SOPs, Work Orders & Production Line Impact');
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.8);
        doc.setTextColor(30, 41, 59);
        const lineText =
          relatedLines.length > 0
            ? relatedLines.map((l) => `${l.code} ${l.name} (${l.status})`).join('  |  ')
            : 'No production lines directly bound.';
        doc.text(`Production Lines: ${lineText}`.slice(0, 110), margin + 1.5, y);
        y += 5.2;

        const sopText =
          relatedSops.length > 0
            ? relatedSops.slice(0, 4).map((s) => `${s.docNumber} v${s.version} — ${s.title}`).join('; ')
            : 'Standard facility GMP SOPs apply.';
        const sopLines = doc.splitTextToSize(`Controlled SOPs: ${sopText}`, contentW - 3);
        ensureSpace(sopLines.length * 4.5 + 4);
        doc.text(sopLines, margin + 1.5, y);
        y += sopLines.length * 4.4 + 2;

        if (relatedWorkOrders.length > 0) {
          relatedWorkOrders.slice(0, 5).forEach((wo) => {
            ensureSpace(5.5);
            doc.text(
              `Work Order ${wo.woNumber} [${wo.status.toUpperCase()} · ${wo.priority}]: ${wo.title} (Due ${wo.dueDate}, ${wo.assigneeName})`.slice(
                0,
                112
              ),
              margin + 1.5,
              y
            );
            y += 4.6;
          });
        }
      }

      // Section 6: Reviewer Notes & 21 CFR Part 11 QA Sign-off
      if (includeSignOff) {
        drawSectionTitle('6. QA Review & 21 CFR Part 11 Electronic Sign-Off');
        if (reportNotes.trim()) {
          const noteLines = doc.splitTextToSize(`Reviewer Notes: ${reportNotes.trim()}`, contentW - 3);
          ensureSpace(noteLines.length * 4.5 + 16);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8);
          doc.setTextColor(30, 41, 59);
          doc.text(noteLines, margin + 1.5, y);
          y += noteLines.length * 4.4 + 4;
        }
        ensureSpace(16);
        doc.setDrawColor(148, 163, 184);
        doc.line(margin + 1, y + 8, margin + 78, y + 8);
        doc.line(margin + 96, y + 8, pageW - margin - 1, y + 8);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(100, 116, 139);
        doc.text(`Prepared / Reviewed By: ${reviewerName || 'QA Compliance Officer'}`, margin + 1, y + 12.5);
        doc.text(`QA Release Signature & Timestamp (UTC): ${generatedIso.slice(0, 19)}Z`, margin + 96, y + 12.5);
      }

      // Footer page numbering on all pages
      const totalPages = doc.getNumberOfPages();
      for (let p = 1; p <= totalPages; p++) {
        doc.setPage(p);
        doc.setDrawColor(226, 232, 240);
        doc.line(margin, pageH - 12, pageW - margin, pageH - 12);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.2);
        doc.setTextColor(100, 116, 139);
        doc.text(`${reportCode}  ·  Controlled GMP Digital Twin Export`, margin, pageH - 7.5);
        doc.text(`Page ${p} of ${totalPages}`, pageW - margin, pageH - 7.5, { align: 'right' });
      }

      const safeFile = `${asset.assetId.replace(/[^a-zA-Z0-9_-]/g, '_')}_FMEA_GMP_Report_${generatedIso.slice(0, 10)}.pdf`;
      doc.save(safeFile);

      recordAudit({
        category: 'validation-ai',
        action: `Exported Asset FMEA & GMP PDF Report (${asset.assetId})`,
        entityType: 'asset',
        entityId: asset.id,
        entityName: `${asset.assetId} · ${asset.name}`,
        summary: `Generated ${reportCode} · Status: ${summary.overallStatus} · Max RPN ${summary.maxRpn} · ${assetSensors.length} live telemetry sensors`,
      });
      showToast(`Downloaded ${safeFile}`, 'success');
    } catch (err: any) {
      showToast(err?.message || 'Unable to generate PDF report', 'error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 p-0 sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeModal();
      }}
    >
      <div className="w-full max-w-4xl h-[100dvh] sm:h-auto sm:max-h-[92vh] rounded-none sm:rounded-3xl bg-white dark:bg-[#111116] border-0 sm:border border-zinc-200 dark:border-zinc-800 shadow-2xl flex flex-col overflow-hidden">
        {/* Modal Header */}
        <header className="shrink-0 px-4 sm:px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/90 dark:bg-[#16161D] flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
              <FileText className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400 truncate">
                {reportCode} · Live Telemetry + FMEA + GMP Compliance PDF
              </div>
              <h2 className="text-base sm:text-lg font-bold text-zinc-900 dark:text-zinc-50 truncate">
                Asset FMEA &amp; GMP Compliance Report Generator
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={closeModal}
            className="min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200/70 dark:hover:bg-zinc-800 transition-colors cursor-pointer shrink-0"
            aria-label="Close PDF report dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {/* Scrollable Content: Configuration + Live Document Preview */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y px-4 sm:px-6 py-5 space-y-5">
          {/* Asset Selector & Report Options Bar */}
          <div className="p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-[#15151E] space-y-3.5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  Selected Asset
                </span>
                <select
                  value={asset.id}
                  onChange={(e) => setSelectedAssetId(e.target.value)}
                  className="w-full min-h-[40px] px-3 rounded-xl bg-white dark:bg-[#111116] border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-900 dark:text-zinc-100"
                >
                  {scene.assets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.assetId} · {a.name} ({a.category})
                    </option>
                  ))}
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  QA Reviewer / Sign-Off Name
                </span>
                <input
                  value={reviewerName}
                  onChange={(e) => setReviewerName(e.target.value)}
                  placeholder="QA Compliance Officer"
                  className="w-full min-h-[40px] px-3 rounded-xl bg-white dark:bg-[#111116] border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100"
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-zinc-700 dark:text-zinc-300">
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeTelemetry}
                  onChange={(e) => setIncludeTelemetry(e.target.checked)}
                  className="accent-violet-600"
                />
                <span>Live Telemetry ({assetSensors.length})</span>
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeGmpCycles}
                  onChange={(e) => setIncludeGmpCycles(e.target.checked)}
                  className="accent-violet-600"
                />
                <span>GMP Cal / OQ-PQ / PM</span>
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeFmeaHistory}
                  onChange={(e) => setIncludeFmeaHistory(e.target.checked)}
                  className="accent-violet-600"
                />
                <span>FMEA Risk History ({assetIncidents.length})</span>
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeSopsAndLines}
                  onChange={(e) => setIncludeSopsAndLines(e.target.checked)}
                  className="accent-violet-600"
                />
                <span>SOPs &amp; Lines</span>
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeSignOff}
                  onChange={(e) => setIncludeSignOff(e.target.checked)}
                  className="accent-violet-600"
                />
                <span>21 CFR Part 11 Sign-Off</span>
              </label>
            </div>

            <input
              value={reportNotes}
              onChange={(e) => setReportNotes(e.target.value)}
              placeholder="Optional executive summary or QA disposition note to embed in the PDF..."
              className="w-full min-h-[38px] px-3 rounded-xl bg-white dark:bg-[#111116] border border-zinc-200 dark:border-zinc-700 text-xs text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
            />
          </div>

          {/* Live Print-Grade Report Preview Sheet */}
          <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#13131A] p-4 sm:p-5 space-y-5">
            {/* Preview Document Header */}
            <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-zinc-200 dark:border-zinc-800">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-xs font-mono text-zinc-500 dark:text-zinc-400">
                  <Cpu className="w-3.5 h-3.5 text-violet-500" />
                  <span className="font-bold text-zinc-900 dark:text-zinc-100">{asset.assetId}</span>
                  <span>·</span>
                  <span>{asset.category}</span>
                  <span>·</span>
                  <span>{building?.code ?? 'Site'} / {floor?.code ?? 'FL'} / {room?.code ?? 'Zone'}</span>
                </div>
                <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                  {asset.name}
                </h3>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  {asset.manufacturer} {asset.model} · S/N {asset.serialNumber} · Owner: {asset.owner} · Cost Center {asset.costCenter ?? 'CC-GMP-100'}
                </div>
              </div>

              <div className="text-right">
                <div
                  className={`text-sm font-bold font-mono ${
                    summary.overallStatus === 'BLOCKED'
                      ? 'text-rose-500'
                      : summary.overallStatus === 'ATTENTION'
                        ? 'text-amber-500'
                        : 'text-emerald-500'
                  }`}
                >
                  {summary.overallStatus}
                </div>
                <div className="text-[11px] font-mono text-zinc-400 tabular-nums">
                  Telemetry: {serverTime || 'Live'}
                </div>
              </div>
            </div>

            {/* Executive KPI Row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-[#181822]">
                <div className="text-[11px] text-zinc-500">GMP Readiness</div>
                <div
                  className={`mt-0.5 text-base font-bold font-mono tabular-nums ${
                    summary.overallStatus === 'BLOCKED'
                      ? 'text-rose-500'
                      : summary.overallStatus === 'ATTENTION'
                        ? 'text-amber-500'
                        : 'text-emerald-500'
                  }`}
                >
                  {summary.overallStatus}
                </div>
                <div className="text-[10.5px] text-zinc-500 font-mono tabular-nums">
                  {summary.overdueCycles} overdue · {summary.dueSoonCycles} due soon
                </div>
              </div>

              <div className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-[#181822]">
                <div className="text-[11px] text-zinc-500">Peak FMEA Risk</div>
                <div
                  className={`mt-0.5 text-base font-bold font-mono tabular-nums ${getRpnPriority(summary.maxRpn).textClass}`}
                >
                  RPN {summary.maxRpn}
                </div>
                <div className="text-[10.5px] text-zinc-500 font-mono tabular-nums">
                  Max S×O {summary.maxSo} · {summary.openRiskCount} open
                </div>
              </div>

              <div className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-[#181822]">
                <div className="text-[11px] text-zinc-500">Live Telemetry</div>
                <div className="mt-0.5 text-base font-bold font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
                  {assetSensors.length} Sensors
                </div>
                <div className="text-[10.5px] text-zinc-500 font-mono tabular-nums">
                  {summary.alarmSensors} alarm · {summary.warnSensors} warn · {summary.nominalSensors} ok
                </div>
              </div>

              <div className="p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-[#181822]">
                <div className="text-[11px] text-zinc-500">Condition &amp; Load</div>
                <div className="mt-0.5 text-base font-bold font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
                  {asset.conditionScore}% · {asset.energyKw} kW
                </div>
                <div className="text-[10.5px] text-zinc-500 font-mono tabular-nums">
                  {asset.operationalStatus} · {summary.openWoCount} open WO
                </div>
              </div>
            </div>

            {/* Preview Section 1: Live Telemetry */}
            {includeTelemetry && (
              <section className="space-y-2">
                <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-emerald-500" />
                  Live Telemetry Snapshot ({assetSensors.length} Sensors)
                </div>
                {assetSensors.length === 0 ? (
                  <div className="text-xs text-zinc-500 py-2">
                    No live environmental or process sensors attached directly to {asset.assetId}.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-zinc-50 dark:bg-[#181822] border-b border-zinc-200 dark:border-zinc-800 text-[11px] text-zinc-500">
                          <th className="px-3 py-2 font-semibold">Tag</th>
                          <th className="px-3 py-2 font-semibold">Parameter</th>
                          <th className="px-3 py-2 font-semibold text-right">Live Value</th>
                          <th className="px-3 py-2 font-semibold text-right">Limits</th>
                          <th className="px-3 py-2 font-semibold text-right">State</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
                        {assetSensors.map((sn) => {
                          const snap = readings[sn.id];
                          const status = snap?.status ?? 'nominal';
                          return (
                            <tr key={sn.id}>
                              <td className="px-3 py-1.5 font-mono text-[11px] font-semibold text-zinc-800 dark:text-zinc-200">
                                {sn.tag}
                              </td>
                              <td className="px-3 py-1.5 text-zinc-600 dark:text-zinc-300">
                                {sn.name}{' '}
                                <span className="text-[10.5px] text-zinc-400">({sn.targetCode})</span>
                              </td>
                              <td className="px-3 py-1.5 text-right font-mono font-bold tabular-nums text-zinc-900 dark:text-zinc-100">
                                {snap ? snap.value.toFixed(2) : sn.nominal} {sn.unit}
                              </td>
                              <td className="px-3 py-1.5 text-right font-mono text-[11px] tabular-nums text-zinc-500">
                                {sn.alarmLow}–{sn.alarmHigh}
                              </td>
                              <td className="px-3 py-1.5 text-right font-mono text-[11px] font-bold">
                                <span
                                  className={
                                    status === 'alarm'
                                      ? 'text-rose-500'
                                      : status === 'warning'
                                        ? 'text-amber-500'
                                        : 'text-emerald-500'
                                  }
                                >
                                  {status.toUpperCase()}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}

            {/* Preview Section 2: GMP Compliance Cycles */}
            {includeGmpCycles && compliance && (
              <section className="space-y-2">
                <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-violet-500" />
                  GMP Compliance &amp; Qualification Status
                </div>
                <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-zinc-50 dark:bg-[#181822] border-b border-zinc-200 dark:border-zinc-800 text-[11px] text-zinc-500">
                        <th className="px-3 py-2 font-semibold">Cycle</th>
                        <th className="px-3 py-2 font-semibold">Status</th>
                        <th className="px-3 py-2 font-semibold">Last Done</th>
                        <th className="px-3 py-2 font-semibold">Next Due</th>
                        <th className="px-3 py-2 font-semibold">Protocol</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
                      {[
                        { label: 'Calibration', rec: compliance.calibration },
                        { label: `Qualification (${compliance.qualification.stage})`, rec: compliance.qualification },
                        { label: 'Preventive Maintenance', rec: compliance.maintenance },
                      ].map(({ label, rec }) => (
                        <tr key={label}>
                          <td className="px-3 py-1.5 font-medium text-zinc-900 dark:text-zinc-100">
                            {label}
                          </td>
                          <td className="px-3 py-1.5 font-mono text-[11px] font-bold">
                            <span
                              className={
                                rec.status === 'overdue'
                                  ? 'text-rose-500'
                                  : rec.status === 'due-soon'
                                    ? 'text-amber-500'
                                    : 'text-emerald-500'
                              }
                            >
                              {rec.status.toUpperCase()}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 font-mono tabular-nums text-zinc-600 dark:text-zinc-300">
                            {rec.lastDate}
                          </td>
                          <td className="px-3 py-1.5 font-mono tabular-nums text-zinc-600 dark:text-zinc-300">
                            {rec.nextDueDate}
                          </td>
                          <td className="px-3 py-1.5 font-mono text-[11px] text-zinc-500">
                            {rec.certificateOrProtocol}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Preview Section 3: FMEA Risk History */}
            {includeFmeaHistory && (
              <section className="space-y-2">
                <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5 text-amber-500" />
                  FMEA Risk History ({assetIncidents.length})
                </div>
                {assetIncidents.length === 0 ? (
                  <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 py-1">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Zero open or historical FMEA risk incidents linked to this asset.</span>
                  </div>
                ) : (
                  <div className="divide-y divide-zinc-200 dark:divide-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-800">
                    {assetIncidents.map((inc) => {
                      const prio = getRpnPriority(inc.rpn);
                      return (
                        <div key={inc.id} className="p-3 space-y-1 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                              <span className="font-mono text-violet-600 dark:text-violet-300 mr-1.5">
                                {inc.code}
                              </span>
                              {inc.title}
                            </div>
                            <div className="font-mono tabular-nums shrink-0">
                              <span className={`font-bold ${prio.textClass}`}>RPN {inc.rpn}</span>
                              <span className="text-zinc-400 ml-1.5">
                                (S×O {inc.severity * inc.occurrence})
                              </span>
                            </div>
                          </div>
                          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                            {inc.status.toUpperCase()} · {inc.failureMode} — {inc.cause}
                            {inc.linkedWorkOrderId ? ` · CAPA ${inc.linkedWorkOrderId}` : ''}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <footer className="shrink-0 px-4 sm:px-6 py-3.5 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/90 dark:bg-[#16161D] flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              fetchLiveSnapshot(scene);
              showToast('Refreshed live telemetry snapshot for report', 'info');
            }}
            className="min-h-[40px] px-3.5 rounded-xl border border-zinc-300 dark:border-zinc-700 hover:border-violet-500 text-xs font-medium text-zinc-700 dark:text-zinc-200 inline-flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5 text-emerald-500" />
            Refresh Telemetry
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={closeModal}
              className="min-h-[40px] px-4 rounded-xl border border-zinc-300 dark:border-zinc-700 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
            >
              Close
            </button>
            <button
              type="button"
              disabled={exporting}
              onClick={handleDownloadPdf}
              className="min-h-[40px] px-5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              {exporting ? 'Generating PDF...' : 'Download PDF Report'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
};
