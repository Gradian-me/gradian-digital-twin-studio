import type { CleanroomGrade, SpaceCategory, SpaceTypeTemplate, WallPresetId } from '../types/twin';

interface SpaceSeed {
  id: string;
  name: string;
  category: SpaceCategory;
  color: string;
  w: number;
  d: number;
  h?: number;
  grade?: CleanroomGrade;
  pa?: number;
  ach?: number;
  temp?: number;
  rh?: number;
  floorMat?: string;
  wallPreset?: WallPresetId;
  cost?: number;
  eq?: string[];
  compliance?: string;
}

const seeds: SpaceSeed[] = [
  // Pharmaceutical Manufacturing
  { id: 'st-biopharma-prod', name: 'Biopharmaceutical Production', category: 'Pharmaceutical Manufacturing', color: '#3B82F6', w: 12, d: 9, h: 4.2, grade: 'Grade C / ISO 7', pa: 30, ach: 25, temp: 20, rh: 45, floorMat: 'mat-epoxy-clean-blue', wallPreset: 'cleanroom-panel', cost: 4800, eq: ['eq-bioreactor-ss', 'eq-bioreactor-su', 'eq-buffer-tank'], compliance: 'EU GMP Annex 1 / FDA 21 CFR 211' },
  { id: 'st-api-mfg', name: 'API Manufacturing', category: 'Pharmaceutical Manufacturing', color: '#2563EB', w: 12, d: 10, h: 4.4, grade: 'Grade D / ISO 8', pa: 15, ach: 15, temp: 21, rh: 50, floorMat: 'mat-epoxy-gray', wallPreset: 'cleanroom-panel', cost: 4200, eq: ['eq-process-vessel', 'eq-centrifuge'], compliance: 'ICH Q7 GMP' },
  { id: 'st-formulation', name: 'Formulation Manufacturing', category: 'Pharmaceutical Manufacturing', color: '#1D4ED8', w: 10, d: 8, h: 3.8, grade: 'Grade C / ISO 7', pa: 30, ach: 25, temp: 20, rh: 45, floorMat: 'mat-epoxy-clean-blue', wallPreset: 'cleanroom-panel', cost: 4400, eq: ['eq-mixing-tank', 'eq-filtration-skid'], compliance: 'EU GMP Annex 1' },
  { id: 'st-cell-culture', name: 'Cell Culture / Upstream', category: 'Pharmaceutical Manufacturing', color: '#2563EB', w: 12, d: 8, h: 4.0, grade: 'Grade C / ISO 7', pa: 30, ach: 25, temp: 20, rh: 45, floorMat: 'mat-epoxy-clean-blue', wallPreset: 'cleanroom-panel', cost: 5200, eq: ['eq-bioreactor-ss', 'eq-seed-reactor', 'eq-media-tank'], compliance: 'EU GMP Annex 1 / ISO 14644' },
  { id: 'st-fermentation', name: 'Fermentation Suite', category: 'Pharmaceutical Manufacturing', color: '#1E40AF', w: 12, d: 9, h: 4.4, grade: 'Grade C / ISO 7', pa: 25, ach: 20, temp: 21, rh: 50, floorMat: 'mat-epoxy-gray', wallPreset: 'cleanroom-panel', cost: 4900, eq: ['eq-fermenter', 'eq-cip-skid'], compliance: 'EU GMP Annex 2' },
  { id: 'st-downstream', name: 'Downstream Purification', category: 'Pharmaceutical Manufacturing', color: '#0284C7', w: 10, d: 8, h: 3.8, grade: 'Grade C / ISO 7', pa: 30, ach: 25, temp: 19, rh: 45, floorMat: 'mat-epoxy-clean-blue', wallPreset: 'cleanroom-panel', cost: 5100, eq: ['eq-chrom-skid', 'eq-tff-skid', 'eq-buffer-tank'], compliance: 'EU GMP Annex 1' },
  { id: 'st-aseptic-filling', name: 'Aseptic Filling & Lyophilization', category: 'Pharmaceutical Manufacturing', color: '#0369A1', w: 11, d: 8, h: 3.8, grade: 'Grade A / ISO 5', pa: 45, ach: 60, temp: 19, rh: 40, floorMat: 'mat-epoxy-clean-blue', wallPreset: 'cleanroom-panel', cost: 7200, eq: ['eq-vial-filler', 'eq-isolator', 'eq-lyophilizer'], compliance: 'EU GMP Annex 1 (2022)' },
  { id: 'st-vaccine-prod', name: 'Vaccine Production', category: 'Pharmaceutical Manufacturing', color: '#0EA5E9', w: 12, d: 9, h: 4.0, grade: 'Grade B / ISO 6', pa: 40, ach: 40, temp: 20, rh: 45, floorMat: 'mat-epoxy-clean-blue', wallPreset: 'cleanroom-panel', cost: 6200, eq: ['eq-bioreactor-su', 'eq-isolator'], compliance: 'WHO GMP / BSL-2' },
  { id: 'st-packaging', name: 'Secondary Packaging', category: 'Pharmaceutical Manufacturing', color: '#38BDF8', w: 12, d: 8, h: 3.6, grade: 'CNC (Controlled)', pa: 10, ach: 10, temp: 22, rh: 50, floorMat: 'mat-epoxy-gray', wallPreset: 'interior-standard', cost: 2400, eq: ['eq-packaging-line', 'eq-cartoner'], compliance: 'Serialization DSCSA / FMD' },
  { id: 'st-inspection', name: 'Visual Inspection Area', category: 'Pharmaceutical Manufacturing', color: '#60A5FA', w: 8, d: 6, h: 3.4, grade: 'Grade D / ISO 8', pa: 15, ach: 15, temp: 21, rh: 45, floorMat: 'mat-epoxy-gray', wallPreset: 'cleanroom-panel', cost: 3100, eq: ['eq-inspection-machine'], compliance: 'USP <790>' },
  { id: 'st-weighing-dispensing', name: 'Weighing & Dispensing', category: 'Pharmaceutical Manufacturing', color: '#3B82F6', w: 7, d: 6, h: 3.4, grade: 'Grade D / ISO 8', pa: -5, ach: 20, temp: 20, rh: 45, floorMat: 'mat-epoxy-gray', wallPreset: 'cleanroom-panel', cost: 3500, eq: ['eq-dispensing-booth', 'eq-weighing-station'], compliance: 'GMP Containment' },
  { id: 'st-media-buffer', name: 'Media & Buffer Preparation', category: 'Pharmaceutical Manufacturing', color: '#0EA5E9', w: 9, d: 7, h: 3.8, grade: 'Grade D / ISO 8', pa: 15, ach: 20, temp: 20, rh: 50, floorMat: 'mat-epoxy-gray', wallPreset: 'cleanroom-panel', cost: 3800, eq: ['eq-media-tank', 'eq-buffer-tank', 'eq-filtration-skid'], compliance: 'EU GMP Grade D' },
  { id: 'st-containment', name: 'Potent / Cytotoxic Containment', category: 'Pharmaceutical Manufacturing', color: '#6366F1', w: 9, d: 7, h: 3.6, grade: 'Grade C / ISO 7', pa: -15, ach: 30, temp: 20, rh: 45, floorMat: 'mat-epoxy-clean-blue', wallPreset: 'cleanroom-panel', cost: 6100, eq: ['eq-isolator', 'eq-dispensing-booth'], compliance: 'OEB-5 / Negative Pressure' },
  { id: 'st-sterile-wash', name: 'Component Wash & Sterilization', category: 'Pharmaceutical Manufacturing', color: '#38BDF8', w: 8, d: 7, h: 3.6, grade: 'Grade C / ISO 7', pa: 20, ach: 20, temp: 22, rh: 50, floorMat: 'mat-epoxy-gray', wallPreset: 'cleanroom-panel', cost: 4300, eq: ['eq-autoclave', 'eq-cip-skid'], compliance: 'ISO 17665' },

  // Cleanrooms
  { id: 'st-cr-grade-a', name: 'Cleanroom Grade A (ISO 5)', category: 'Cleanrooms', color: '#06B6D4', w: 8, d: 6, h: 3.6, grade: 'Grade A / ISO 5', pa: 45, ach: 60, temp: 19, rh: 40, floorMat: 'mat-epoxy-clean-blue', wallPreset: 'cleanroom-panel', cost: 7500, eq: ['eq-isolator', 'eq-laminar-hood'], compliance: 'ISO 14644-1 Class 5' },
  { id: 'st-cr-grade-b', name: 'Cleanroom Grade B (ISO 6)', category: 'Cleanrooms', color: '#0891B2', w: 9, d: 7, h: 3.6, grade: 'Grade B / ISO 6', pa: 40, ach: 40, temp: 19, rh: 45, floorMat: 'mat-epoxy-clean-blue', wallPreset: 'cleanroom-panel', cost: 6400, eq: ['eq-vial-filler', 'eq-particle-counter'], compliance: 'ISO 14644-1 Class 6' },
  { id: 'st-cr-grade-c', name: 'Cleanroom Grade C (ISO 7)', category: 'Cleanrooms', color: '#0E7490', w: 10, d: 8, h: 3.6, grade: 'Grade C / ISO 7', pa: 30, ach: 25, temp: 20, rh: 45, floorMat: 'mat-epoxy-clean-blue', wallPreset: 'cleanroom-panel', cost: 4800, eq: ['eq-bioreactor-su', 'eq-chrom-skid'], compliance: 'ISO 14644-1 Class 7' },
  { id: 'st-cr-grade-d', name: 'Cleanroom Grade D (ISO 8)', category: 'Cleanrooms', color: '#155E75', w: 10, d: 8, h: 3.6, grade: 'Grade D / ISO 8', pa: 15, ach: 15, temp: 21, rh: 50, floorMat: 'mat-vinyl-cleanroom', wallPreset: 'cleanroom-panel', cost: 3600, eq: ['eq-autoclave'], compliance: 'ISO 14644-1 Class 8' },
  { id: 'st-pal', name: 'Personnel Airlock (PAL)', category: 'Cleanrooms', color: '#22D3EE', w: 4, d: 4, h: 3.2, grade: 'Grade C / ISO 7', pa: 20, ach: 25, temp: 20, rh: 45, floorMat: 'mat-vinyl-cleanroom', wallPreset: 'cleanroom-panel', cost: 3900, eq: ['eq-locker', 'eq-wash-station'], compliance: 'Interlocked Cascade' },
  { id: 'st-mal', name: 'Material Airlock (MAL)', category: 'Cleanrooms', color: '#67E8F9', w: 4.5, d: 4, h: 3.4, grade: 'Grade C / ISO 7', pa: 20, ach: 25, temp: 20, rh: 45, floorMat: 'mat-epoxy-gray', wallPreset: 'cleanroom-panel', cost: 3800, eq: ['eq-pallet'], compliance: 'Sanitization Interlock' },
  { id: 'st-gowning', name: 'Gowning / Degowning Room', category: 'Cleanrooms', color: '#06B6D4', w: 5, d: 4, h: 3.2, grade: 'Grade C / ISO 7', pa: 25, ach: 25, temp: 20, rh: 45, floorMat: 'mat-vinyl-cleanroom', wallPreset: 'cleanroom-panel', cost: 3700, eq: ['eq-bench', 'eq-locker'], compliance: 'EU GMP Gowning' },
  { id: 'st-clean-corridor', name: 'Clean Corridor', category: 'Cleanrooms', color: '#38BDF8', w: 16, d: 3.5, h: 3.4, grade: 'Grade C / ISO 7', pa: 25, ach: 20, temp: 20, rh: 45, floorMat: 'mat-epoxy-clean-blue', wallPreset: 'cleanroom-panel', cost: 3200, eq: ['eq-sensor-env'], compliance: 'Positive Cascade' },
  { id: 'st-dirty-corridor', name: 'Dirty / Return Corridor', category: 'Cleanrooms', color: '#64748B', w: 14, d: 3, h: 3.4, grade: 'CNC (Controlled)', pa: 5, ach: 10, temp: 22, rh: 50, floorMat: 'mat-epoxy-gray', wallPreset: 'interior-standard', cost: 2200, eq: [], compliance: 'Waste Segregation' },
  { id: 'st-decon', name: 'Decontamination / Pass-Through', category: 'Cleanrooms', color: '#0891B2', w: 4, d: 3.5, h: 3.2, grade: 'Grade C / ISO 7', pa: 15, ach: 30, temp: 20, rh: 45, floorMat: 'mat-epoxy-clean-blue', wallPreset: 'cleanroom-panel', cost: 4500, eq: ['eq-autoclave'], compliance: 'VHP Bio-Decon' },

  // Quality & Laboratories
  { id: 'st-qc-analytical', name: 'QC Analytical Laboratory', category: 'Quality & Laboratories', color: '#10B981', w: 11, d: 8, h: 3.4, grade: 'CNC (Controlled)', pa: 5, ach: 12, temp: 21, rh: 45, floorMat: 'mat-ceramic-lab', wallPreset: 'glass-partition', cost: 3600, eq: ['eq-hplc', 'eq-lcms', 'eq-lab-bench', 'eq-fume-hood'], compliance: 'ISO/IEC 17025 / GLP' },
  { id: 'st-qc-micro', name: 'QC Microbiology Laboratory', category: 'Quality & Laboratories', color: '#059669', w: 10, d: 8, h: 3.4, grade: 'Grade C / ISO 7', pa: 15, ach: 20, temp: 20, rh: 45, floorMat: 'mat-vinyl-cleanroom', wallPreset: 'cleanroom-panel', cost: 4200, eq: ['eq-biosafety-cab', 'eq-incubator', 'eq-autoclave'], compliance: 'USP <71> / BSL-2' },
  { id: 'st-stability-room', name: 'Stability Chamber Room', category: 'Quality & Laboratories', color: '#047857', w: 8, d: 6, h: 3.4, grade: 'CNC (Controlled)', pa: 5, ach: 10, temp: 22, rh: 45, floorMat: 'mat-epoxy-gray', wallPreset: 'insulated-sandwich', cost: 3400, eq: ['eq-stability-chamber', 'eq-ul-freezer'], compliance: 'ICH Q1A(R2)' },
  { id: 'st-rd-lab', name: 'Biotech R&D Laboratory', category: 'Quality & Laboratories', color: '#34D399', w: 10, d: 8, h: 3.4, grade: 'CNC (Controlled)', pa: 0, ach: 12, temp: 21, rh: 45, floorMat: 'mat-ceramic-lab', wallPreset: 'glass-partition', cost: 3500, eq: ['eq-biosafety-cab', 'eq-pcr', 'eq-lab-bench'], compliance: 'BSL-2 Research' },
  { id: 'st-sample-receiving', name: 'Sample Receiving & Prep', category: 'Quality & Laboratories', color: '#10B981', w: 6, d: 5, h: 3.2, grade: 'CNC (Controlled)', pa: 5, ach: 10, temp: 21, rh: 50, floorMat: 'mat-epoxy-gray', wallPreset: 'interior-standard', cost: 2500, eq: ['eq-lab-bench', 'eq-lab-fridge'], compliance: 'Chain of Custody' },
  { id: 'st-retention-sample', name: 'Retention Sample Storage', category: 'Quality & Laboratories', color: '#059669', w: 6, d: 5, h: 3.2, grade: 'CNC (Controlled)', pa: 5, ach: 8, temp: 20, rh: 45, floorMat: 'mat-epoxy-gray', wallPreset: 'fire-rated', cost: 2400, eq: ['eq-shelving', 'eq-lab-fridge'], compliance: '21 CFR 211.170' },
  { id: 'st-sterility-testing', name: 'Sterility Testing Suite', category: 'Quality & Laboratories', color: '#0D9488', w: 7, d: 6, h: 3.4, grade: 'Grade A / ISO 5', pa: 35, ach: 40, temp: 20, rh: 45, floorMat: 'mat-epoxy-clean-blue', wallPreset: 'cleanroom-panel', cost: 5800, eq: ['eq-isolator', 'eq-incubator'], compliance: 'USP <71> Isolator' },
  { id: 'st-qa-office', name: 'QA Documentation & Batch Review', category: 'Quality & Laboratories', color: '#14B8A6', w: 8, d: 6, h: 3.2, grade: 'Unclassified', pa: 0, ach: 6, temp: 22, rh: 50, floorMat: 'mat-wood-oak', wallPreset: 'glass-partition', cost: 1900, eq: ['eq-desk', 'eq-cabinet'], compliance: 'ALCOA+ Data Integrity' },

  // Warehouses & Logistics
  { id: 'st-raw-warehouse', name: 'Raw Material Warehouse', category: 'Warehouses & Logistics', color: '#F59E0B', w: 14, d: 10, h: 5.5, grade: 'CNC (Controlled)', pa: 0, ach: 6, temp: 20, rh: 50, floorMat: 'mat-concrete-sealed', wallPreset: 'exterior-structural', cost: 1800, eq: ['eq-pallet-rack', 'eq-forklift', 'eq-pallet'], compliance: 'GDP Controlled Ambient' },
  { id: 'st-finished-warehouse', name: 'Finished Goods Warehouse', category: 'Warehouses & Logistics', color: '#D97706', w: 14, d: 10, h: 5.5, grade: 'CNC (Controlled)', pa: 0, ach: 6, temp: 20, rh: 50, floorMat: 'mat-concrete-sealed', wallPreset: 'exterior-structural', cost: 1900, eq: ['eq-pallet-rack', 'eq-conveyor'], compliance: 'EU GDP' },
  { id: 'st-cold-storage', name: 'Cold Storage (2–8 °C)', category: 'Warehouses & Logistics', color: '#0284C7', w: 10, d: 8, h: 4.5, grade: 'CNC (Controlled)', pa: 0, ach: 8, temp: 5, rh: 45, floorMat: 'mat-concrete-sealed', wallPreset: 'insulated-sandwich', cost: 3600, eq: ['eq-pallet-rack', 'eq-sensor-env'], compliance: 'WHO Cold Chain' },
  { id: 'st-frozen-storage', name: 'Frozen Storage (-20 °C)', category: 'Warehouses & Logistics', color: '#1D4ED8', w: 8, d: 6, h: 4.2, grade: 'CNC (Controlled)', pa: 0, ach: 6, temp: -20, rh: 35, floorMat: 'mat-concrete-sealed', wallPreset: 'insulated-sandwich', cost: 4200, eq: ['eq-pallet-rack', 'eq-ul-freezer'], compliance: 'Cold-Chain Mapped' },
  { id: 'st-quarantine', name: 'Quarantine Storage', category: 'Warehouses & Logistics', color: '#EA580C', w: 8, d: 6, h: 4.5, grade: 'CNC (Controlled)', pa: 0, ach: 6, temp: 20, rh: 50, floorMat: 'mat-concrete-sealed', wallPreset: 'industrial-partition', cost: 1700, eq: ['eq-pallet-rack', 'eq-pallet'], compliance: 'Physical Segregation' },
  { id: 'st-loading-dock', name: 'Receiving & Loading Dock', category: 'Warehouses & Logistics', color: '#B45309', w: 10, d: 7, h: 4.8, grade: 'Unclassified', pa: 0, ach: 6, temp: 18, rh: 55, floorMat: 'mat-concrete-sealed', wallPreset: 'exterior-structural', cost: 1600, eq: ['eq-forklift', 'eq-conveyor', 'eq-weighing-station'], compliance: 'Dock Leveler Safety' },
  { id: 'st-dispatch', name: 'Dispatch & Cold-Pack Staging', category: 'Warehouses & Logistics', color: '#F59E0B', w: 9, d: 7, h: 4.5, grade: 'CNC (Controlled)', pa: 0, ach: 6, temp: 18, rh: 50, floorMat: 'mat-concrete-sealed', wallPreset: 'interior-standard', cost: 1800, eq: ['eq-packing-station', 'eq-pallet'], compliance: 'GDP Thermal Shipping' },
  { id: 'st-dangerous-goods', name: 'Dangerous Goods Vault', category: 'Warehouses & Logistics', color: '#DC2626', w: 6, d: 5, h: 4.0, grade: 'Unclassified', pa: -10, ach: 15, temp: 18, rh: 45, floorMat: 'mat-concrete-sealed', wallPreset: 'fire-rated', cost: 3400, eq: ['eq-drum', 'eq-fire-ext'], compliance: 'ATEX / NFPA 30' },

  // Utilities
  { id: 'st-hvac-plant', name: 'HVAC / AHU Mechanical Plant', category: 'Utilities', color: '#64748B', w: 12, d: 8, h: 4.6, grade: 'Unclassified', pa: 0, ach: 8, temp: 24, rh: 55, floorMat: 'mat-concrete-sealed', wallPreset: 'concrete', cost: 3200, eq: ['eq-ahu', 'eq-chiller'], compliance: 'ASHRAE / ISPE HVAC' },
  { id: 'st-wfi-room', name: 'Purified Water & WFI Plant', category: 'Utilities', color: '#0EA5E9', w: 10, d: 7, h: 4.2, grade: 'CNC (Controlled)', pa: 5, ach: 10, temp: 22, rh: 50, floorMat: 'mat-epoxy-gray', wallPreset: 'cleanroom-panel', cost: 4900, eq: ['eq-wfi-skid', 'eq-water-tank', 'eq-ro-unit'], compliance: 'USP / EP WFI Loop' },
  { id: 'st-electrical', name: 'Electrical Switchgear & MCC', category: 'Utilities', color: '#475569', w: 8, d: 6, h: 3.8, grade: 'Unclassified', pa: 0, ach: 6, temp: 23, rh: 45, floorMat: 'mat-rubber-safety', wallPreset: 'fire-rated', cost: 2800, eq: ['eq-electrical-panel', 'eq-ups', 'eq-transformer'], compliance: 'IEC 61439 / NFPA 70E' },
  { id: 'st-generator', name: 'Backup Generator Room', category: 'Utilities', color: '#334155', w: 8, d: 6, h: 4.4, grade: 'Unclassified', pa: 0, ach: 12, temp: 28, rh: 55, floorMat: 'mat-concrete-sealed', wallPreset: 'fire-rated', cost: 2900, eq: ['eq-generator'], compliance: 'NFPA 110' },
  { id: 'st-server-room', name: 'OT/IT Server & SCADA Room', category: 'Utilities', color: '#4F46E5', w: 7, d: 5, h: 3.4, grade: 'CNC (Controlled)', pa: 5, ach: 15, temp: 19, rh: 40, floorMat: 'mat-rubber-safety', wallPreset: 'fire-rated', cost: 3600, eq: ['eq-electrical-panel', 'eq-ups'], compliance: '21 CFR Part 11 / GAMP 5' },
  { id: 'st-chiller-boiler', name: 'Chiller & Clean Steam Plant', category: 'Utilities', color: '#475569', w: 10, d: 7, h: 4.5, grade: 'Unclassified', pa: 0, ach: 10, temp: 26, rh: 55, floorMat: 'mat-concrete-sealed', wallPreset: 'concrete', cost: 3400, eq: ['eq-chiller', 'eq-boiler', 'eq-compressor'], compliance: 'ASME BPE' },
  { id: 'st-wastewater', name: 'Biowaste Kill & Effluent Room', category: 'Utilities', color: '#64748B', w: 8, d: 6, h: 4.0, grade: 'Unclassified', pa: -10, ach: 12, temp: 22, rh: 55, floorMat: 'mat-concrete-sealed', wallPreset: 'concrete', cost: 3100, eq: ['eq-water-tank', 'eq-process-pump'], compliance: 'Biosafety Kill Tank' },

  // Offices & Administrative
  { id: 'st-exec-office', name: 'Executive Office', category: 'Offices & Administration', color: '#8B5CF6', w: 6, d: 5, h: 3.2, grade: 'Unclassified', pa: 0, ach: 6, temp: 22, rh: 50, floorMat: 'mat-wood-oak', wallPreset: 'glass-partition', cost: 1800, eq: ['eq-desk', 'eq-chair', 'eq-sofa'], compliance: 'Workplace Ergonomics' },
  { id: 'st-open-office', name: 'Engineering Open Office', category: 'Offices & Administration', color: '#7C3AED', w: 10, d: 8, h: 3.2, grade: 'Unclassified', pa: 0, ach: 6, temp: 22, rh: 50, floorMat: 'mat-wood-oak', wallPreset: 'interior-standard', cost: 1600, eq: ['eq-desk', 'eq-chair', 'eq-cabinet'], compliance: 'ASHRAE 62.1' },
  { id: 'st-conference', name: 'Conference / Board Room', category: 'Offices & Administration', color: '#6D28D9', w: 8, d: 6, h: 3.2, grade: 'Unclassified', pa: 0, ach: 8, temp: 22, rh: 48, floorMat: 'mat-wood-oak', wallPreset: 'glass-partition', cost: 2000, eq: ['eq-conf-table', 'eq-chair'], compliance: 'Acoustic STC-48' },
  { id: 'st-lobby', name: 'Main Reception & Lobby', category: 'Offices & Administration', color: '#A78BFA', w: 9, d: 7, h: 3.8, grade: 'Unclassified', pa: 0, ach: 6, temp: 22, rh: 50, floorMat: 'mat-stone-slate', wallPreset: 'glass-partition', cost: 2200, eq: ['eq-reception-desk', 'eq-sofa'], compliance: 'Visitor Access Control' },
  { id: 'st-training', name: 'GMP Training Room', category: 'Offices & Administration', color: '#8B5CF6', w: 8, d: 6, h: 3.2, grade: 'Unclassified', pa: 0, ach: 8, temp: 22, rh: 50, floorMat: 'mat-vinyl-cleanroom', wallPreset: 'interior-standard', cost: 1700, eq: ['eq-conf-table', 'eq-chair'], compliance: 'GMP Qualification' },
  { id: 'st-break-room', name: 'Cafeteria & Break Room', category: 'Offices & Administration', color: '#C084FC', w: 8, d: 6, h: 3.2, grade: 'Unclassified', pa: 0, ach: 8, temp: 22, rh: 50, floorMat: 'mat-vinyl-cleanroom', wallPreset: 'interior-standard', cost: 1600, eq: ['eq-conf-table', 'eq-sink'], compliance: 'Food Hygiene' },
  { id: 'st-locker-room', name: 'Employee Locker & Change', category: 'Offices & Administration', color: '#9333EA', w: 7, d: 5, h: 3.2, grade: 'Unclassified', pa: -5, ach: 10, temp: 22, rh: 50, floorMat: 'mat-ceramic-lab', wallPreset: 'interior-standard', cost: 1800, eq: ['eq-locker', 'eq-bench'], compliance: 'Pre-GMP Change' },

  // Other Industrial
  { id: 'st-control-room', name: 'Central Control & BMS Room', category: 'Other Industrial', color: '#475569', w: 8, d: 6, h: 3.4, grade: 'CNC (Controlled)', pa: 5, ach: 10, temp: 21, rh: 45, floorMat: 'mat-rubber-safety', wallPreset: 'glass-partition', cost: 3100, eq: ['eq-desk', 'eq-electrical-panel'], compliance: 'SCADA / EMS 24/7' },
  { id: 'st-maintenance', name: 'Maintenance & Calibration Shop', category: 'Other Industrial', color: '#64748B', w: 9, d: 7, h: 4.0, grade: 'Unclassified', pa: 0, ach: 8, temp: 21, rh: 50, floorMat: 'mat-concrete-sealed', wallPreset: 'industrial-partition', cost: 2100, eq: ['eq-workbench', 'eq-shelving'], compliance: 'Metrology ISO 10012' },
  { id: 'st-security', name: 'Security & Fire Control Room', category: 'Other Industrial', color: '#DC2626', w: 5, d: 4, h: 3.2, grade: 'Unclassified', pa: 0, ach: 8, temp: 21, rh: 45, floorMat: 'mat-rubber-safety', wallPreset: 'fire-rated', cost: 2600, eq: ['eq-desk', 'eq-fire-alarm'], compliance: 'NFPA 72' },
  { id: 'st-staircase', name: 'Fire Staircase & Core', category: 'Other Industrial', color: '#94A3B8', w: 5, d: 4, h: 3.8, grade: 'Unclassified', pa: 25, ach: 10, temp: 20, rh: 50, floorMat: 'mat-concrete-sealed', wallPreset: 'fire-rated', cost: 2000, eq: ['eq-exit-sign'], compliance: 'Pressurized Egress' },
  { id: 'st-corridor', name: 'General Industrial Corridor', category: 'Other Industrial', color: '#94A3B8', w: 14, d: 3, h: 3.4, grade: 'Unclassified', pa: 0, ach: 6, temp: 21, rh: 50, floorMat: 'mat-epoxy-gray', wallPreset: 'interior-standard', cost: 1400, eq: ['eq-fire-ext'], compliance: 'ADA / Egress 1.8m' },
];

export const SPACE_TYPE_LIBRARY: SpaceTypeTemplate[] = seeds.map((s) => ({
  id: s.id,
  name: s.name,
  category: s.category,
  color: s.color,
  defaultWidth: s.w,
  defaultDepth: s.d,
  defaultHeight: s.h ?? 3.6,
  defaultWallPreset: s.wallPreset ?? 'cleanroom-panel',
  defaultFloorMaterialId: s.floorMat ?? 'mat-epoxy-gray',
  defaultWallMaterialId:
    s.wallPreset === 'glass-partition'
      ? 'mat-glass-cleanroom'
      : s.wallPreset === 'concrete'
        ? 'mat-concrete-sealed'
        : 'mat-cleanroom-panel',
  defaultCeilingMaterialId: 'mat-ceiling-acoustic',
  environmental: {
    cleanroomGrade: s.grade ?? 'Unclassified',
    pressurePa: s.pa ?? 0,
    airChangesPerHour: s.ach ?? 10,
    temperatureC: s.temp ?? 21,
    humidityPct: s.rh ?? 45,
    monitoringRequired: (s.grade ?? 'Unclassified') !== 'Unclassified',
  },
  safetyClass: s.pa !== undefined && s.pa < 0 ? 'Negative Containment' : 'Standard Industrial',
  complianceStandard: s.compliance ?? 'ISO 9001',
  recommendedEquipment: s.eq ?? [],
  costPerSqm: s.cost ?? 2500,
}));

export const SPACE_CATEGORIES: SpaceCategory[] = [
  'Pharmaceutical Manufacturing',
  'Cleanrooms',
  'Quality & Laboratories',
  'Warehouses & Logistics',
  'Utilities',
  'Offices & Administration',
  'Other Industrial',
];
