// --- START OF FILE src/types/index.ts ---

// Sabit yerleşim kuralı (Bu yapı değişmedi, gelecekte kullanılabilir)
export interface FixedPlacement {
  day: 'Pazartesi' | 'Salı' | 'Çarşamba' | 'Perşembe' | 'Cuma';
  periods: string[];
}

export interface Teacher {
  id: string;
  name: string;
  branch: string;
  branches?: string[];
  level: 'Anaokulu' | 'İlkokul' | 'Ortaokul';
  levels?: ('Anaokulu' | 'İlkokul' | 'Ortaokul')[];
  subjectIds?: string[];
  createdAt: Date;
}

export interface Subject {
  id: string;
  name: string;
  branch: string;
  level: 'Anaokulu' | 'İlkokul' | 'Ortaokul';
  levels?: ('Anaokulu' | 'İlkokul' | 'Ortaokul')[];
  weeklyHours: number;
  createdAt: Date;
}

// YENİ: Sınıfa atanan bir öğretmenin hangi dersleri verdiğini belirten arayüz
export interface TeacherAssignment {
  teacherId: string;
  subjectIds: string[];
}

// GÜNCELLENDİ: Class arayüzü yeni `assignments` yapısını içeriyor
export interface Class {
  id: string;
  name: string;
  level: 'Anaokulu' | 'İlkokul' | 'Ortaokul';
  levels?: ('Anaokulu' | 'İlkokul' | 'Ortaokul')[];
  createdAt: Date;
  classTeacherId?: string; // Sınıf öğretmeni ID'si (opsiyonel)
  assignments?: TeacherAssignment[]; // YENİ VE DAHA DOĞRU YAPI
  // Geriye dönük uyumluluk için bu alanı silebilir veya null bırakabilirsiniz.
  teacherIds?: string[]; 
}

export interface ScheduleSlot {
  subjectId?: string;
  classId?: string;
  teacherId?: string;
  isFixed?: boolean;
}

export interface Schedule {
  id: string;
  teacherId: string;
  schedule: {
    [day: string]: {
      [period: string]: ScheduleSlot | null;
    };
  };
  createdAt: Date;
  updatedAt: Date;
}

export const DAYS: ('Pazartesi' | 'Salı' | 'Çarşamba' | 'Perşembe' | 'Cuma')[] = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma'];
export const PERIODS: string[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
export const EDUCATION_LEVELS: readonly ['Anaokulu', 'İlkokul', 'Ortaokul'] = ['Anaokulu', 'İlkokul', 'Ortaokul'];

export interface TimePeriod {
  period: string;
  startTime: string;
  endTime: string;
  isBreak?: boolean;
}

export const PRIMARY_SCHOOL_TIME_PERIODS: TimePeriod[] = [ { period: '1', startTime: '08:50', endTime: '09:25' }, /* ... */ ];
export const MIDDLE_SCHOOL_TIME_PERIODS: TimePeriod[] = [ { period: '1', startTime: '08:40', endTime: '09:15' }, /* ... */ ];
export const KINDERGARTEN_TIME_PERIODS: TimePeriod[] = PRIMARY_SCHOOL_TIME_PERIODS;

export const getTimePeriods = (level?: 'Anaokulu' | 'İlkokul' | 'Ortaokul'): TimePeriod[] => { /* ... */ };
export const getTimeForPeriod = (period: string, level?: 'Anaokulu' | 'İlkokul' | 'Ortaokul'): TimePeriod | undefined => { /* ... */ };
export const formatTimeRange = (startTime: string, endTime: string): string => `${startTime} - ${endTime}`;

// --- END OF FILE src/types/index.ts ---