// --- START OF FILE src/utils/scheduleGeneration.ts ---

import { DAYS, PERIODS, Schedule, Teacher, Class, Subject, ScheduleSlot } from '../types';
import { SubjectTeacherMapping, EnhancedGenerationResult } from '../types/wizard';
import { TimeConstraint } from '../types/constraints';
import { parseDistributionPattern } from '../types';

/**
 * Belirli bir sınıf için TÜM sabit periyotları (Yemek, Hazırlık, Kahvaltılar vb.) program ızgarasına ekler.
 */
function addFixedPeriodsToGrid(grid: Schedule['schedule'], classLevel: 'Anaokulu' | 'İlkokul' | 'Ortaokul') {
  const fixedSlot: ScheduleSlot = { isFixed: true, classId: 'fixed-period' };
  const lunchPeriod = (classLevel === 'Ortaokul') ? '6' : '5';
  const fixedPeriodsMap: { [period: string]: ScheduleSlot } = {
    'prep': { ...fixedSlot, subjectId: 'fixed-prep' },
    'afternoon-breakfast': { ...fixedSlot, subjectId: 'fixed-afternoon-breakfast' },
    [lunchPeriod]: { ...fixedSlot, subjectId: 'fixed-lunch' },
  };
  if (classLevel === 'Ortaokul') {
    fixedPeriodsMap['breakfast'] = { ...fixedSlot, subjectId: 'fixed-breakfast' };
  }
  DAYS.forEach(day => {
    Object.entries(fixedPeriodsMap).forEach(([period, slotData]) => {
      if (!grid[day]) grid[day] = {};
      grid[day][period] = slotData;
    });
  });
}

/**
 * Sistematik olarak, çakışmaları ve zaman kısıtlamalarını dikkate alarak ders programını oluşturur.
 * Bu versiyon, dağıtım şekline göre blok ders yerleştirme yapar ve sınıf bazlı çalışır.
 */
export function generateSystematicSchedule(
  mappings: SubjectTeacherMapping[],
  allTeachers: Teacher[],
  allClasses: Class[],
  allSubjects: Subject[],
  timeConstraints: TimeConstraint[]
): EnhancedGenerationResult {
  
  const startTime = Date.now();
  console.log('🚀 Program oluşturma başlatıldı (v36 - Sınıf Bazlı Gelişmiş Blok Ders Yerleştirme)...');

  // --- Hazırlık Aşaması ---
  const classScheduleGrids: { [classId: string]: Schedule['schedule'] } = {};
  const teacherAvailability = new Map<string, Set<string>>();
  
  // Öğretmen başına toplam ders saati hedeflerini hesapla
  const teacherTargetHours = new Map<string, number>();
  mappings.forEach(m => {
    const currentHours = teacherTargetHours.get(m.teacherId) || 0;
    teacherTargetHours.set(m.teacherId, currentHours + m.weeklyHours);
  });
  
  // Sınıf başına toplam ders saati hedeflerini hesapla
  const classTargetHours = new Map<string, number>();
  mappings.forEach(m => {
    const currentHours = classTargetHours.get(m.classId) || 0;
    classTargetHours.set(m.classId, currentHours + m.weeklyHours);
  });

  const selectedClassIds = new Set(mappings.map(m => m.classId));

  // Sınıf programlarını ve sabit periyotları oluştur
  allClasses.forEach(c => {
    if (selectedClassIds.has(c.id)) {
      classScheduleGrids[c.id] = {};
      DAYS.forEach(day => { 
        classScheduleGrids[c.id][day] = {};
      });
      addFixedPeriodsToGrid(classScheduleGrids[c.id], c.level);
    }
  });
  
  // Öğretmen müsaitlik durumlarını başlat
  allTeachers.forEach(t => {
    if (mappings.some(m => m.teacherId === t.id)) {
      teacherAvailability.set(t.id, new Set<string>());
      
      // Sabit periyotları öğretmen müsaitlik durumuna ekle
      DAYS.forEach(day => {
        // Hazırlık/Kahvaltı
        teacherAvailability.get(t.id)!.add(`${day}-prep`);
        
        // Öğle yemeği
        const lunchPeriod = (t.level === 'Ortaokul') ? '6' : '5';
        teacherAvailability.get(t.id)!.add(`${day}-${lunchPeriod}`);
        
        // Ortaokul kahvaltı
        if (t.level === 'Ortaokul') {
          teacherAvailability.get(t.id)!.add(`${day}-breakfast`);
        }
        
        // İkindi kahvaltısı
        teacherAvailability.get(t.id)!.add(`${day}-afternoon-breakfast`);
      });
    }
  });
  
  // Kısıtlamaları haritaya ekle
  const constraintMap = new Map<string, string>();
  timeConstraints.forEach(c => {
    const key = `${c.entityType}-${c.entityId}-${c.day}-${c.period}`;
    constraintMap.set(key, c.constraintType);
  });

  // --- Ders Yerleştirme Aşaması ---
  // Sınıf bazlı sıralama - Önce anaokulu, sonra ilkokul, sonra ortaokul
  const sortedClassIds = Array.from(selectedClassIds).sort((a, b) => {
    const classA = allClasses.find(c => c.id === a);
    const classB = allClasses.find(c => c.id === b);
    const levelOrder = { 'Anaokulu': 1, 'İlkokul': 2, 'Ortaokul': 3 };
    return (levelOrder[classA?.level || 'Ortaokul'] - levelOrder[classB?.level || 'Ortaokul']) || classA!.name.localeCompare(classB!.name);
  });
  
  // Her öğretmen için yerleştirilen ders saatlerini takip et
  const teacherPlacedHours = new Map<string, number>();
  allTeachers.forEach(t => {
    if (mappings.some(m => m.teacherId === t.id)) {
      teacherPlacedHours.set(t.id, 0);
    }
  });
  
  // Her sınıf için
  for (const classId of sortedClassIds) {
    const classItem = allClasses.find(c => c.id === classId)!;
    console.log(`🏫 ${classItem.name} sınıfı için ders yerleştirme başlatılıyor...`);
    
    // Bu sınıfa ait tüm dersleri al
    const classLessons = mappings.filter(m => m.classId === classId);
    
    // Dersleri öncelik sırasına göre sırala:
    // 1. Dağıtım şekli olan dersler (blok sayısına göre azalan sırada)
    // 2. Haftalık saati fazla olan dersler
    classLessons.sort((a, b) => {
      const subjectA = allSubjects.find(s => s.id === a.subjectId);
      const subjectB = allSubjects.find(s => s.id === b.subjectId);
      
      const hasDistributionA = !!subjectA?.distributionPattern;
      const hasDistributionB = !!subjectB?.distributionPattern;
      
      // Önce dağıtım şekli olan dersleri sırala
      if (hasDistributionA && !hasDistributionB) return -1;
      if (!hasDistributionA && hasDistributionB) return 1;
      
      if (hasDistributionA && hasDistributionB) {
        // İkisinde de dağıtım şekli varsa, blok sayısına göre sırala
        const blocksA = parseDistributionPattern(subjectA!.distributionPattern!).length;
        const blocksB = parseDistributionPattern(subjectB!.distributionPattern!).length;
        
        // Daha fazla blok olan önce
        if (blocksA !== blocksB) return blocksB - blocksA;
      }
      
      // Son olarak haftalık saate göre sırala
      return b.weeklyHours - a.weeklyHours;
    });
    
    // Her ders için
    for (const lesson of classLessons) {
      const subject = allSubjects.find(s => s.id === lesson.subjectId)!;
      const teacher = allTeachers.find(t => t.id === lesson.teacherId)!;
      
      console.log(`📚 ${classItem.name} - ${subject.name} (${lesson.weeklyHours} saat) - ${teacher.name} için ders yerleştirme başlatılıyor...`);
      
      // Dağıtım şekli varsa, blok ders yerleştirme yap
      if (subject.distributionPattern) {
        const distributionBlocks = parseDistributionPattern(subject.distributionPattern);
        
        // Toplam saatlerin eşit olduğunu kontrol et
        const totalHours = distributionBlocks.reduce((sum, hours) => sum + hours, 0);
        if (totalHours !== lesson.weeklyHours) {
          console.warn(`⚠️ Uyumsuz dağıtım şekli: ${subject.name} dersi için ${lesson.weeklyHours} saat bekleniyor, dağıtım toplamı ${totalHours}`);
          // Dağıtım şekli geçersizse, normal yerleştirme yap
          placeRegularLesson(lesson, classScheduleGrids[classId], teacherAvailability, teacherPlacedHours);
          continue;
        }
        
        // Blok ders yerleştirme işlemi
        const success = placeBlockLesson(
          lesson,
          classScheduleGrids[classId],
          teacherAvailability,
          teacherPlacedHours,
          distributionBlocks,
          true // Ardışık günleri tercih et
        );
        
        if (success) {
          console.log(`✅ Blok ders yerleştirildi: ${subject.name} (${subject.distributionPattern}) - ${classItem.name}`);
        } else {
          // İlk denemede başarısız olduysa, ardışık gün tercihini kaldırarak tekrar dene
          const retrySuccess = placeBlockLesson(
            lesson,
            classScheduleGrids[classId],
            teacherAvailability,
            teacherPlacedHours,
            distributionBlocks,
            false // Ardışık günleri tercih etme
          );
          
          if (retrySuccess) {
            console.log(`✅ Blok ders yerleştirildi (ikinci deneme): ${subject.name} (${subject.distributionPattern}) - ${classItem.name}`);
          } else {
            console.log(`❌ Blok ders yerleştirilemedi: ${subject.name} (${subject.distributionPattern}) - ${classItem.name}`);
            // Blok yerleştirme başarısız olduysa, normal yerleştirme dene
            placeRegularLesson(lesson, classScheduleGrids[classId], teacherAvailability, teacherPlacedHours);
          }
        }
      } else {
        // Dağıtım şekli olmayan dersler için normal yerleştirme
        placeRegularLesson(lesson, classScheduleGrids[classId], teacherAvailability, teacherPlacedHours);
      }
    }
    
    console.log(`✅ ${classItem.name} sınıfı için ders yerleştirme tamamlandı.`);
  }

  // --- Sonuçları Oluşturma ve Raporlama Aşaması ---
  const teacherSchedules: { [teacherId: string]: Schedule['schedule'] } = {};
  
  // Sınıf programlarından öğretmen programlarını oluştur
  Object.entries(classScheduleGrids).forEach(([classId, classGrid]) => {
    Object.entries(classGrid).forEach(([day, periods]) => {
      Object.entries(periods).forEach(([period, slot]) => {
        if (slot && slot.teacherId && !slot.isFixed) {
          if (!teacherSchedules[slot.teacherId]) {
            teacherSchedules[slot.teacherId] = {};
            DAYS.forEach(d => teacherSchedules[slot.teacherId][d] = {});
          }
          
          if (!teacherSchedules[slot.teacherId][day]) {
            teacherSchedules[slot.teacherId][day] = {};
          }
          
          teacherSchedules[slot.teacherId][day][period] = { 
            classId: slot.classId, 
            subjectId: slot.subjectId, 
            isFixed: false 
          };
        }
      });
    });
  });

  // Sabit periyotları öğretmen programlarına ekle
  Object.keys(teacherSchedules).forEach(teacherId => {
    const teacher = allTeachers.find(t => t.id === teacherId);
    if (teacher) {
      DAYS.forEach(day => {
        if (!teacherSchedules[teacherId][day]) {
          teacherSchedules[teacherId][day] = {};
        }
        
        // Hazırlık/Kahvaltı
        teacherSchedules[teacherId][day]['prep'] = { 
          classId: 'fixed-period', 
          subjectId: 'fixed-prep', 
          isFixed: true 
        };
        
        // Öğle yemeği
        const lunchPeriod = (teacher.level === 'Ortaokul') ? '6' : '5';
        teacherSchedules[teacherId][day][lunchPeriod] = { 
          classId: 'fixed-period', 
          subjectId: 'fixed-lunch', 
          isFixed: true 
        };
        
        // Ortaokul kahvaltı
        if (teacher.level === 'Ortaokul') {
          teacherSchedules[teacherId][day]['breakfast'] = { 
            classId: 'fixed-period', 
            subjectId: 'fixed-breakfast', 
            isFixed: true 
          };
        }
        
        // İkindi kahvaltısı
        teacherSchedules[teacherId][day]['afternoon-breakfast'] = { 
          classId: 'fixed-period', 
          subjectId: 'fixed-afternoon-breakfast', 
          isFixed: true 
        };
      });
    }
  });

  const finalSchedules: Omit<Schedule, 'id' | 'createdAt'>[] = Object.entries(teacherSchedules).map(([teacherId, schedule]) => ({
    teacherId, schedule, updatedAt: new Date(),
  }));

  // İstatistikler ve raporlama
  const totalLessonsToPlace = mappings.reduce((sum, m) => sum + m.weeklyHours, 0);
  const placedLessons = Array.from(teacherPlacedHours.values()).reduce((sum, hours) => sum + hours, 0);
  
  // Yerleştirilemeyen dersleri hesapla
  const unassignedLessonsSummary: { className: string, subjectName: string, teacherName: string, missingHours: number }[] = [];
  
  // Her öğretmen için eksik saatleri kontrol et
  teacherTargetHours.forEach((targetHours, teacherId) => {
    const placedHours = teacherPlacedHours.get(teacherId) || 0;
    
    if (placedHours < targetHours) {
      const teacher = allTeachers.find(t => t.id === teacherId);
      
      // Bu öğretmenin hangi dersleri eksik kaldı?
      const teacherMappings = mappings.filter(m => m.teacherId === teacherId);
      
      // Her sınıf için eksik saatleri hesapla
      teacherMappings.forEach(mapping => {
        const classId = mapping.classId;
        const subjectId = mapping.subjectId;
        
        // Bu ders için yerleştirilen saat sayısını hesapla
        let placedHoursForThisSubject = 0;
        
        Object.values(classScheduleGrids[classId]).forEach(day => {
          Object.values(day).forEach(slot => {
            if (slot && slot.teacherId === teacherId && slot.subjectId === subjectId) {
              placedHoursForThisSubject++;
            }
          });
        });
        
        // Eksik saat varsa ekle
        const missingHours = mapping.weeklyHours - placedHoursForThisSubject;
        if (missingHours > 0) {
          const classItem = allClasses.find(c => c.id === classId);
          const subject = allSubjects.find(s => s.id === subjectId);
          
          unassignedLessonsSummary.push({
            className: classItem?.name || 'Bilinmeyen Sınıf',
            subjectName: subject?.name || 'Bilinmeyen Ders',
            teacherName: teacher?.name || 'Bilinmeyen Öğretmen',
            missingHours
          });
        }
      });
    }
  });

  const stats = {
    totalLessonsToPlace,
    placedLessons,
    unassignedLessons: unassignedLessonsSummary
  };

  console.log(`✅ Program oluşturma tamamlandı. Süre: ${(Date.now() - startTime) / 1000} saniye.`);
  console.log(`📊 İstatistik: ${stats.placedLessons} / ${stats.totalLessonsToPlace} ders yerleştirildi (${Math.round(stats.placedLessons / stats.totalLessonsToPlace * 100)}%).`);
  
  // Öğretmen ders saati sayılarını kontrol et ve raporla
  console.log('📊 Öğretmen ders saati dağılımı:');
  teacherTargetHours.forEach((targetHours, teacherId) => {
    const placedHours = teacherPlacedHours.get(teacherId) || 0;
    const teacher = allTeachers.find(t => t.id === teacherId);
    
    if (teacher) {
      console.log(`- ${teacher.name}: ${placedHours}/${targetHours} saat`);
      
      // Eksik saat varsa uyarı ver
      if (placedHours < targetHours) {
        console.warn(`⚠️ ${teacher.name} için ${targetHours - placedHours} saat eksik!`);
      }
    }
  });
  
  const finalWarnings: string[] = [];
  if (stats.unassignedLessons.length > 0) {
    finalWarnings.push(`Bazı dersler yerleştirilemedi. Toplam eksik: ${stats.unassignedLessons.reduce((sum, ul) => sum + ul.missingHours, 0)} saat.`);
    
    // Yerleştirilemeyen derslerin detaylarını ekle
    stats.unassignedLessons.forEach(ul => {
      finalWarnings.push(`- ${ul.className} / ${ul.teacherName} / ${ul.subjectName}: ${ul.missingHours} saat eksik`);
    });
  }

  return {
    success: finalSchedules.length > 0,
    schedules: finalSchedules,
    statistics: stats,
    warnings: finalWarnings,
    errors: [],
  };
}

/**
 * Bir dersin dağıtım şekline göre blok ders yerleştirme işlemini gerçekleştirir.
 * Örneğin "2+2+1" şeklinde bir dağıtım için 3 farklı güne yerleştirme yapar.
 * 
 * @param lessonToPlace Yerleştirilecek ders
 * @param classScheduleGrid Sınıf programı
 * @param teacherAvailability Öğretmen müsaitlik durumu
 * @param teacherPlacedHours Öğretmen yerleştirilen saat sayısı
 * @param distributionBlocks Dağıtım bloklarının saatleri (örn: [2,2,1])
 * @param preferConsecutiveDays Ardışık günleri tercih et
 * @returns Yerleştirme başarılı mı?
 */
function placeBlockLesson(
  lessonToPlace: SubjectTeacherMapping,
  classScheduleGrid: Schedule['schedule'],
  teacherAvailability: Map<string, Set<string>>,
  teacherPlacedHours: Map<string, number>,
  distributionBlocks: number[],
  preferConsecutiveDays: boolean = false
): boolean {
  const { teacherId, classId, subjectId } = lessonToPlace;
  
  // Günleri sırala - ardışık günleri tercih ediyorsak sıralı, yoksa karıştır
  let orderedDays = [...DAYS];
  if (!preferConsecutiveDays) {
    orderedDays = orderedDays.sort(() => Math.random() - 0.5);
  }
  
  // Kullanılan günleri takip et
  const usedDays = new Set<string>();
  
  // Her bir blok için (örn: 2+2+1 için 3 blok)
  for (let blockIndex = 0; blockIndex < distributionBlocks.length; blockIndex++) {
    const blockSize = distributionBlocks[blockIndex]; // Bu bloktaki ders saati sayısı
    let blockPlaced = false;
    
    // Günleri dene
    for (const day of orderedDays) {
      // Eğer bu gün zaten kullanıldıysa, atla
      if (usedDays.has(day)) {
        continue;
      }
      
      // Ardışık ders saatleri bul
      const availableBlockSlots = findConsecutiveSlots(
        day, 
        blockSize, 
        classScheduleGrid, 
        teacherAvailability,
        teacherId
      );
      
      if (availableBlockSlots.length > 0) {
        // İlk bulunan uygun bloğu kullan
        const slotsToUse = availableBlockSlots[0];
        
        // Bu slotları doldur
        for (const slotKey of slotsToUse) {
          const [slotDay, period] = slotKey.split('-');
          
          // Sınıf ve öğretmen programlarını güncelle
          if (!classScheduleGrid[slotDay]) classScheduleGrid[slotDay] = {};
          classScheduleGrid[slotDay][period] = {
            subjectId,
            teacherId,
            classId,
            isFixed: false
          };
          
          // Öğretmen müsaitlik durumunu güncelle
          if (!teacherAvailability.has(teacherId)) {
            teacherAvailability.set(teacherId, new Set<string>());
          }
          teacherAvailability.get(teacherId)?.add(slotKey);
          
          // Yerleştirilen ders saati sayısını artır
          teacherPlacedHours.set(teacherId, (teacherPlacedHours.get(teacherId) || 0) + 1);
        }
        
        // Bu günü kullanılmış olarak işaretle
        usedDays.add(day);
        
        blockPlaced = true;
        break; // Bu blok için başka gün arama
      }
    }
    
    // Eğer bu blok yerleştirilemezse, başarısız
    if (!blockPlaced) {
      console.log(`❌ Blok yerleştirilemedi: ${blockSize} saatlik blok (${blockIndex + 1}/${distributionBlocks.length})`);
      return false;
    }
  }
  
  // Tüm bloklar başarıyla yerleştirildi
  return true;
}

/**
 * Belirli bir günde, belirli bir blok boyutu için ardışık boş slotları bulur.
 * 
 * @param day Gün
 * @param blockSize Blok boyutu (ardışık ders saati sayısı)
 * @param classScheduleGrid Sınıf programı
 * @param teacherAvailability Öğretmen müsaitlik durumu
 * @param teacherId Öğretmen ID'si
 * @returns Ardışık boş slotların listesi
 */
function findConsecutiveSlots(
  day: string,
  blockSize: number,
  classScheduleGrid: Schedule['schedule'],
  teacherAvailability: Map<string, Set<string>>,
  teacherId: string
): string[][] {
  const availableSlots: string[][] = [];
  
  // Sadece normal ders saatlerini kullan (sabit periyotları hariç tut)
  const periodsToCheck = PERIODS.filter(p => {
    const slot = classScheduleGrid[day]?.[p];
    return !slot || !slot.isFixed;
  });
  
  // Ardışık slotları bul
  for (let i = 0; i <= periodsToCheck.length - blockSize; i++) {
    const potentialBlock: string[] = [];
    let isBlockValid = true;
    
    for (let j = 0; j < blockSize; j++) {
      const period = periodsToCheck[i + j];
      const slotKey = `${day}-${period}`;
      
      // Sınıf ve öğretmen müsaitlik kontrolü
      const isClassSlotFree = !classScheduleGrid[day]?.[period];
      const isTeacherSlotFree = !teacherAvailability.get(teacherId)?.has(slotKey);
      
      if (!isClassSlotFree || !isTeacherSlotFree) {
        isBlockValid = false;
        break;
      }
      
      potentialBlock.push(slotKey);
    }
    
    if (isBlockValid && potentialBlock.length === blockSize) {
      availableSlots.push(potentialBlock);
    }
  }
  
  return availableSlots;
}

/**
 * Dağıtım şekli olmayan bir dersi normal şekilde yerleştirir.
 * Mümkün olduğunca blok ders yerleştirmeye çalışır.
 * 
 * @param lesson Yerleştirilecek ders
 * @param classScheduleGrid Sınıf programı
 * @param teacherAvailability Öğretmen müsaitlik durumu
 * @param teacherPlacedHours Öğretmen yerleştirilen saat sayısı
 */
function placeRegularLesson(
  lesson: SubjectTeacherMapping,
  classScheduleGrid: Schedule['schedule'],
  teacherAvailability: Map<string, Set<string>>,
  teacherPlacedHours: Map<string, number>
): void {
  const { teacherId, classId, subjectId, weeklyHours } = lesson;
  
  // Önce blok ders olarak yerleştirmeyi dene (2 veya daha fazla saat için)
  if (weeklyHours >= 2) {
    // Mümkün olan en büyük blokları oluştur
    const blockSizes: number[] = [];
    let remainingHours = weeklyHours;
    
    while (remainingHours > 0) {
      if (remainingHours >= 2) {
        blockSizes.push(2); // 2 saatlik bloklar tercih edilir
        remainingHours -= 2;
      } else {
        blockSizes.push(1);
        remainingHours -= 1;
      }
    }
    
    // Blok ders yerleştirmeyi dene
    const blockSuccess = placeBlockLesson(
      lesson,
      classScheduleGrid,
      teacherAvailability,
      teacherPlacedHours,
      blockSizes,
      false // Ardışık günleri tercih etme
    );
    
    if (blockSuccess) {
      console.log(`✅ Ders blok olarak yerleştirildi: ${lesson.subjectId} - ${lesson.classId}`);
      return; // Başarılı yerleştirme
    }
  }
  
  // Blok yerleştirme başarısız olduysa, tek tek yerleştir
  let placedHours = 0;
  
  // Günleri karıştır
  const shuffledDays = [...DAYS].sort(() => Math.random() - 0.5);
  
  // Her gün için
  for (const day of shuffledDays) {
    // Eğer tüm saatler yerleştirildiyse çık
    if (placedHours >= weeklyHours) break;
    
    // Periyotları karıştır
    const shuffledPeriods = [...PERIODS].sort(() => Math.random() - 0.5);
    
    // Her periyot için
    for (const period of shuffledPeriods) {
      // Eğer tüm saatler yerleştirildiyse çık
      if (placedHours >= weeklyHours) break;
      
      const slotKey = `${day}-${period}`;
      
      // Slot boş mu ve öğretmen müsait mi kontrol et
      const isSlotFree = !classScheduleGrid[day]?.[period];
      const isTeacherFree = !teacherAvailability.get(teacherId)?.has(slotKey);
      
      // Sabit periyot mu kontrol et
      const isFixedPeriod = classScheduleGrid[day]?.[period]?.isFixed;
      
      if (isSlotFree && isTeacherFree && !isFixedPeriod) {
        // Ders saatini yerleştir
        if (!classScheduleGrid[day]) classScheduleGrid[day] = {};
        classScheduleGrid[day][period] = {
          subjectId,
          teacherId,
          classId,
          isFixed: false
        };
        
        // Öğretmen müsaitlik durumunu güncelle
        teacherAvailability.get(teacherId)!.add(slotKey);
        
        // Yerleştirilen ders saati sayısını artır
        placedHours++;
        teacherPlacedHours.set(teacherId, (teacherPlacedHours.get(teacherId) || 0) + 1);
      }
    }
  }
  
  // Yerleştirilen saat sayısını raporla
  if (placedHours === weeklyHours) {
    console.log(`✅ Ders tam yerleştirildi: ${lesson.subjectId} - ${lesson.classId}`);
  } else if (placedHours > 0) {
    console.log(`⚠️ Ders kısmen yerleştirildi: ${lesson.subjectId} - ${lesson.classId} (${placedHours}/${weeklyHours})`);
  } else {
    console.log(`❌ Ders yerleştirilemedi: ${lesson.subjectId} - ${lesson.classId}`);
  }
}

// --- END OF FILE src/utils/scheduleGeneration.ts ---