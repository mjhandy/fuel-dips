import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

type FuelKey = 'regular' | 'supreme' | 'diesel' | 'furnaceOil';

interface ConversionPoint {
  cm: number;
  liters: number;
}

interface RawConversionPoint {
  cm: number;
  inv?: number;
  liters?: number;
}

type RawConversionData = Record<string, RawConversionPoint[]>;
type ConversionData = Record<FuelKey, ConversionPoint[]>;

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly title = signal('Fuel Dip Recorder');

  protected readonly fuelKeys: FuelKey[] = ['regular', 'supreme', 'diesel', 'furnaceOil'];
  protected readonly fuelLabels: Record<FuelKey, string> = {
    regular: 'Regular',
    supreme: 'Supreme',
    diesel: 'Diesel',
    furnaceOil: 'Furnace Oil'
  };

  protected conversionData: ConversionData | null = null;
  protected readonly readings: Record<FuelKey, number> = {
    regular: 0,
    supreme: 0,
    diesel: 0,
    furnaceOil: 0
  };

  protected dipDate = new Date().toISOString().slice(0, 10);
  protected selectedFileName: string | null = null;
  protected selectedFile: File | null = null;
  protected sending = signal(false);

  protected loading = signal(true);
  protected error = signal<string | null>(null);
  protected saveMessage = signal<string | null>(null);

  constructor(private http: HttpClient) {
    this.loadConversionData();
  }

  protected loadConversionData(): void {
    this.loading.set(true);
    this.error.set(null);
    this.saveMessage.set(null);

    this.http.get<RawConversionData>('/backend/data-logging-write.php?mode=conversion').subscribe({
      next: (data) => {
        this.conversionData = this.normalizeConversionData(data);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Unable to load conversion data from the backend.');
        this.loading.set(false);
      }
    });
  }

  private normalizeConversionData(raw: RawConversionData): ConversionData {
    const normalized: ConversionData = {
      regular: [],
      supreme: [],
      diesel: [],
      furnaceOil: []
    };

    for (const [key, points] of Object.entries(raw)) {
      if (!points?.length || !(key in this.fuelLabels)) {
        continue;
      }

      const fuelKey = key as FuelKey;
      normalized[fuelKey] = points
        .map((point) => {
          const liters = point.liters ?? point.inv ?? 0;
          return { cm: Number(point.cm), liters: Number(liters) };
        })
        .filter((point) => Number.isFinite(point.cm) && Number.isFinite(point.liters))
        .sort((a, b) => a.cm - b.cm);
    }

    return normalized;
  }

  protected litersFor(fuel: FuelKey): number {
    const conversion = this.conversionData?.[fuel] ?? [];
    return this.convertCmToLiters(this.readings[fuel], conversion);
  }

  private convertCmToLiters(cm: number, points: ConversionPoint[]): number {
    if (!points.length || cm <= 0) {
      return 0;
    }

    if (cm <= points[0].cm) {
      return points[0].liters;
    }

    const lastPoint = points[points.length - 1];
    if (cm >= lastPoint.cm) {
      return lastPoint.liters;
    }

    for (let index = 0; index < points.length - 1; index += 1) {
      const current = points[index];
      const next = points[index + 1];

      if (cm >= current.cm && cm <= next.cm) {
        const ratio = (cm - current.cm) / (next.cm - current.cm);
        return current.liters + ratio * (next.liters - current.liters);
      }
    }

    return 0;
  }

  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.selectedFile = file;
    this.selectedFileName = file?.name ?? null;
  }

  protected saveDips(): void {
    if (!this.conversionData) {
      this.error.set('Conversion data is not ready yet.');
      return;
    }

    if (!this.dipDate) {
      this.error.set('Please choose a date before sending the dip report.');
      return;
    }

    this.sending.set(true);
    this.saveMessage.set(null);
    this.error.set(null);

    const formData = new FormData();
    formData.append('date', this.dipDate);
    formData.append('readings', JSON.stringify(this.readings));
    formData.append('liters', JSON.stringify(this.fuelKeys.reduce((result, fuel) => {
      result[fuel] = this.litersFor(fuel);
      return result;
    }, {} as Record<FuelKey, number>)));

    if (this.selectedFile) {
      formData.append('document', this.selectedFile, this.selectedFile.name);
    }

    this.http.post<{ message?: string }>('/backend/data-logging-write.php?mode=email', formData).subscribe({
      next: (response) => {
        this.saveMessage.set(response?.message ?? 'Dip report sent successfully.');
        this.sending.set(false);
      },
      error: () => {
        this.error.set('Unable to send the dip report at this time.');
        this.sending.set(false);
      }
    });
  }
}
