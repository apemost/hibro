// Registers and exports only the Chart.js features accepted by Hibro's chart
// specification. This module is loaded lazily so its named imports tree-shake.

import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PieController,
  PointElement,
  ScatterController,
  Title,
  Tooltip,
} from 'chart.js';

Chart.register(
  BarController,
  LineController,
  PieController,
  ScatterController,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  CategoryScale,
  LinearScale,
  Legend,
  Title,
  Tooltip,
);

export { Chart };
