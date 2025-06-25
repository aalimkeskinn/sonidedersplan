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
 * Bir dersin dağıtım şekline göre blok ders yerleştirme işlemini gerçekleştirir.
 * Örneğin "2+2+1" şeklinde bir dağıtım için 3 farklı güne yerleştirme yapar.
 * 
 * @param lessonToPlace Yerleştirilecek ders
 * @param classScheduleGrid Sınıf programı
 * @param teacherAvailability Öğretmen müsaitlik durumu
 * @param allSubjects Tüm dersler
 * @param distributionBlocks Dağıtım bloklarının saatleri (örn: [2,2,1])
 * @param preferConsecutiveDays Ardışık günleri tercih et
 * @returns Yerleştirme başarılı mı?
 */
function placeBlockLesson(
  lessonToPlace: SubjectTeacherMapping,
  classScheduleGrid: Schedule['schedule'],
  teacherAvailability: Map<string, Set<string>>,
  allSubjects: Subject[],
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
  console.log('🚀 Program oluşturma başlatıldı (v34 - Sınıf Bazlı Gelişmiş Blok Ders Yerleştirme)...');

  // --- Hazırlık Aşaması ---
  const classScheduleGrids: { [classId: string]: Schedule['schedule'] } = {};
  const teacherAvailability = new Map<string, Set<string>>();
  
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
  // Sınıf bazlı sıralama
  const sortedClassIds = Array.from(selectedClassIds).sort((a, b) => {
    const classA = allClasses.find(c => c.id === a);
    const classB = allClasses.find(c => c.id === b);
    const levelOrder = { 'Anaokulu': 1, 'İlkokul': 2, 'Ortaokul': 3 };
    return (levelOrder[classA?.level || 'Ortaokul'] - levelOrder[classB?.level || 'Ortaokul']) || classA!.name.localeCompare(classB!.name);
  });
  
  // Her sınıf için yerleştirilecek dersleri takip et
  const placedMappings = new Set<string>();
  
  // Her sınıf için
  for (const classId of sortedClassIds) {
    const classItem = allClasses.find(c => c.id === classId)!;
    console.log(`🏫 ${classItem.name} sınıfı için ders yerleştirme başlatılıyor...`);
    
    // Bu sınıfa ait tüm dersleri al
    const classLessons = mappings.filter(m => m.classId === classId);
    
    // Önce dağıtım şekli olan dersleri yerleştir
    const lessonsWithDistribution = classLessons.filter(lesson => {
      const subject = allSubjects.find(s => s.id === lesson.subjectId);
      return subject?.distributionPattern && !placedMappings.has(lesson.id);
    });
    
    // Dağıtım şekli olan dersleri, blok sayısına göre sırala (daha karmaşık olanlar önce)
    lessonsWithDistribution.sort((a, b) => {
      const subjectA = allSubjects.find(s => s.id === a.subjectId);
      const subjectB = allSubjects.find(s => s.id === b.subjectId);
      
      const blocksA = parseDistributionPattern(subjectA!.distributionPattern!).length;
      const blocksB = parseDistributionPattern(subjectB!.distributionPattern!).length;
      
      // Önce blok sayısına göre sırala (daha fazla blok önce)
      if (blocksA !== blocksB) return blocksB - blocksA;
      
      // Sonra haftalık saate göre sırala (daha fazla saat önce)
      return b.weeklyHours - a.weeklyHours;
    });
    
    // Dağıtım şekli olan dersleri yerleştir
    for (const lesson of lessonsWithDistribution) {
      const subject = allSubjects.find(s => s.id === lesson.subjectId)!;
      const teacher = allTeachers.find(t => t.id === lesson.teacherId)!;
      
      console.log(`📚 ${classItem.name} - ${subject.name} (${subject.distributionPattern}) - ${teacher.name} için blok ders yerleştirme başlatılıyor...`);
      
      const distributionBlocks = parseDistributionPattern(subject.distributionPattern!);
      
      // Toplam saatlerin eşit olduğunu kontrol et
      const totalHours = distributionBlocks.reduce((sum, hours) => sum + hours, 0);
      if (totalHours !== lesson.weeklyHours) {
        console.warn(`⚠️ Uyumsuz dağıtım şekli: ${subject.name} dersi için ${lesson.weeklyHours} saat bekleniyor, dağıtım toplamı ${totalHours}`);
        continue;
      }
      
      // Blok ders yerleştirme işlemi
      const success = placeBlockLesson(
        lesson,
        classScheduleGrids[classId],
        teacherAvailability,
        allSubjects,
        distributionBlocks,
        true // Ardışık günleri tercih et
      );
      
      if (success) {
        placedMappings.add(lesson.id);
        lesson.assignedHours = lesson.weeklyHours; // Tüm saatler atandı
        console.log(`✅ Blok ders yerleştirildi: ${subject.name} (${subject.distributionPattern}) - ${classItem.name}`);
      } else {
        // İlk denemede başarısız olduysa, ardışık gün tercihini kaldırarak tekrar dene
        const retrySuccess = placeBlockLesson(
          lesson,
          classScheduleGrids[classId],
          teacherAvailability,
          allSubjects,
          distributionBlocks,
          false // Ardışık günleri tercih etme
        );
        
        if (retrySuccess) {
          placedMappings.add(lesson.id);
          lesson.assignedHours = lesson.weeklyHours; // Tüm saatler atandı
          console.log(`✅ Blok ders yerleştirildi (ikinci deneme): ${subject.name} (${subject.distributionPattern}) - ${classItem.name}`);
        } else {
          console.log(`❌ Blok ders yerleştirilemedi: ${subject.name} (${subject.distributionPattern}) - ${classItem.name}`);
        }
      }
    }
    
    // Dağıtım şekli olmayan dersleri yerleştir
    const lessonsWithoutDistribution = classLessons.filter(lesson => 
      !placedMappings.has(lesson.id)
    );
    
    // Haftalık saati fazla olan dersleri önce yerleştir
    lessonsWithoutDistribution.sort((a, b) => b.weeklyHours - a.weeklyHours);
    
    for (const lesson of lessonsWithoutDistribution) {
      const subject = allSubjects.find(s => s.id === lesson.subjectId)!;
      const teacher = allTeachers.find(t => t.id === lesson.teacherId)!;
      
      console.log(`📚 ${classItem.name} - ${subject.name} (${lesson.weeklyHours} saat) - ${teacher.name} için ders yerleştirme başlatılıyor...`);
      
      // Önce blok ders olarak yerleştirmeyi dene (2 veya daha fazla saat için)
      if (lesson.weeklyHours >= 2) {
        // Mümkün olan en büyük blokları oluştur
        const blockSizes: number[] = [];
        let remainingHours = lesson.weeklyHours;
        
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
          classScheduleGrids[classId],
          teacherAvailability,
          allSubjects,
          blockSizes,
          false // Ardışık günleri tercih etme
        );
        
        if (blockSuccess) {
          placedMappings.add(lesson.id);
          lesson.assignedHours = lesson.weeklyHours; // Tüm saatler atandı
          console.log(`✅ Ders blok olarak yerleştirildi: ${subject.name} - ${classItem.name}`);
          continue; // Sonraki derse geç
        }
      }
      
      // Blok yerleştirme başarısız olduysa, tek tek yerleştir
      let placedHours = 0;
      
      for (let hour = 0; hour < lesson.weeklyHours; hour++) {
        let placed = false;
        
        // Tüm günleri karıştır
        const shuffledDays = [...DAYS].sort(() => Math.random() - 0.5);
        
        for (const day of shuffledDays) {
          // Eğer bu gün zaten bu ders için kullanıldıysa, atla
          // Bu, derslerin farklı günlere dağıtılmasını sağlar
          if (Object.values(classScheduleGrids[classId][day] || {}).some(slot => 
            slot && slot.subjectId === lesson.subjectId && slot.teacherId === lesson.teacherId
          )) {
            continue;
          }
          
          // Tüm periyotları karıştır
          const shuffledPeriods = [...PERIODS].sort(() => Math.random() - 0.5);
          
          for (const period of shuffledPeriods) {
            const slotKey = `${day}-${period}`;
            
            // Slot boş mu ve öğretmen müsait mi kontrol et
            const isSlotFree = !classScheduleGrids[classId][day]?.[period];
            const isTeacherFree = !teacherAvailability.get(lesson.teacherId)?.has(slotKey);
            
            // Sabit periyot mu kontrol et
            const isFixedPeriod = period === 'prep' || period === 'breakfast' || 
                                 period === (classItem.level === 'Ortaokul' ? '6' : '5') || 
                                 period === 'afternoon-breakfast';
            
            // Kısıtlama kontrolü
            const isTeacherUnavailable = constraintMap.get(`teacher-${lesson.teacherId}-${day}-${period}`) === 'unavailable';
            const isClassUnavailable = constraintMap.get(`class-${lesson.classId}-${day}-${period}`) === 'unavailable';
            const isSubjectUnavailable = constraintMap.get(`subject-${lesson.subjectId}-${day}-${period}`) === 'unavailable';
            
            if (isSlotFree && isTeacherFree && !isFixedPeriod && !isTeacherUnavailable && !isClassUnavailable && !isSubjectUnavailable) {
              // Ders saatini yerleştir
              if (!classScheduleGrids[classId][day]) classScheduleGrids[classId][day] = {};
              classScheduleGrids[classId][day][period] = {
                subjectId: lesson.subjectId,
                teacherId: lesson.teacherId,
                classId: lesson.classId,
                isFixed: false
              };
              
              // Öğretmen müsaitlik durumunu güncelle
              teacherAvailability.get(lesson.teacherId)!.add(slotKey);
              
              placedHours++;
              placed = true;
              break; // Bu gün için başka periyot arama
            }
          }
          
          if (placed) break; // Bu ders saati için başka gün arama
        }
      }
      
      // Yerleştirilen saat sayısını güncelle
      lesson.assignedHours = placedHours;
      
      if (placedHours === lesson.weeklyHours) {
        placedMappings.add(lesson.id);
        console.log(`✅ Ders tam yerleştirildi: ${subject.name} - ${classItem.name}`);
      } else if (placedHours > 0) {
        console.log(`⚠️ Ders kısmen yerleştirildi: ${subject.name} - ${classItem.name} (${placedHours}/${lesson.weeklyHours})`);
      } else {
        console.log(`❌ Ders yerleştirilemedi: ${subject.name} - ${classItem.name}`);
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
  const placedLessons = mappings.reduce((sum, m) => sum + (m.assignedHours || 0), 0);
  
  const unassignedLessonsSummary = mappings
    .filter(m => (m.assignedHours || 0) < m.weeklyHours)
    .map(m => ({
      className: allClasses.find(c => c.id === m.classId)?.name || 'Bilinmeyen Sınıf',
      subjectName: allSubjects.find(s => s.id === m.subjectId)?.name || 'Bilinmeyen Ders',
      teacherName: allTeachers.find(t => t.id === m.teacherId)?.name || 'Bilinmeyen Öğretmen',
      missingHours: m.weeklyHours - (m.assignedHours || 0)
    }));

  const stats = {
    totalLessonsToPlace,
    placedLessons,
    unassignedLessons: unassignedLessonsSummary
  };

  console.log(`✅ Program oluşturma tamamlandı. Süre: ${(Date.now() - startTime) / 1000} saniye.`);
  console.log(`📊 İstatistik: ${stats.placedLessons} / ${stats.totalLessonsToPlace} ders yerleştirildi (${Math.round(stats.placedLessons / stats.totalLessonsToPlace * 100)}%).`);
  
  // Öğretmen ders saati sayılarını kontrol et ve raporla
  const teacherHourCounts = new Map<string, number>();
  
  Object.entries(teacherSchedules).forEach(([teacherId, schedule]) => {
    let count = 0;
    Object.values(schedule).forEach(day => {
      Object.entries(day).forEach(([period, slot]) => {
        // Sadece normal dersleri say, sabit periyotları sayma
        if (slot && !slot.isFixed && slot.classId !== 'fixed-period') {
          count++;
        }
      });
    });
    teacherHourCounts.set(teacherId, count);
  });
  
  // Öğretmenlerin ders saati sayılarını raporla
  console.log('📊 Öğretmen ders saati dağılımı:');
  teacherHourCounts.forEach((hours, teacherId) => {
    const teacher = allTeachers.find(t => t.id === teacherId);
    if (teacher) {
      // Öğretmenin CSV'den gelen toplam ders saatini hesapla
      const expectedHours = mappings
        .filter(m => m.teacherId === teacherId)
        .reduce((sum, m) => sum + m.weeklyHours, 0);
      
      console.log(`- ${teacher.name}: ${hours}/${expectedHours} saat`);
      
      // Eksik saat varsa uyarı ver
      if (hours < expectedHours) {
        console.warn(`⚠️ ${teacher.name} için ${expectedHours - hours} saat eksik!`);
      }
    }
  });
  
  // Blok ders yerleştirme istatistikleri
  const blockLessonStats = analyzeBlockLessonPlacement(classScheduleGrids, allSubjects, allTeachers);
  console.log(`📊 Blok Ders İstatistikleri: ${blockLessonStats.successfulBlocks} başarılı blok, ${blockLessonStats.totalBlocks} toplam blok`);
  
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
 * Blok ders yerleştirme istatistiklerini analiz eder.
 */
function analyzeBlockLessonPlacement(
  classScheduleGrids: { [classId: string]: Schedule['schedule'] },
  allSubjects: Subject[],
  allTeachers: Teacher[]
): { successfulBlocks: number, totalBlocks: number, blocksBySubject: Record<string, { success: number, total: number }> } {
  const blocksBySubject: Record<string, { success: number, total: number }> = {};
  let successfulBlocks = 0;
  let totalBlocks = 0;
  
  // Her sınıf için
  Object.entries(classScheduleGrids).forEach(([classId, classGrid]) => {
    // Her gün için
    DAYS.forEach(day => {
      // Her ders için blok analizi yap
      const subjectTeacherBlocks = new Map<string, { subjectId: string, teacherId: string, count: number }>();
      
      // Ardışık periyotları tara
      for (let i = 0; i < PERIODS.length; i++) {
        const period = PERIODS[i];
        const slot = classGrid[day]?.[period];
        
        if (slot && !slot.isFixed) {
          const key = `${slot.subjectId}-${slot.teacherId}`;
          
          // Önceki periyot aynı ders mi?
          if (i > 0) {
            const prevPeriod = PERIODS[i - 1];
            const prevSlot = classGrid[day]?.[prevPeriod];
            
            if (prevSlot && !prevSlot.isFixed && 
                prevSlot.subjectId === slot.subjectId && 
                prevSlot.teacherId === slot.teacherId) {
              // Mevcut bloğu güncelle
              if (subjectTeacherBlocks.has(key)) {
                const block = subjectTeacherBlocks.get(key)!;
                block.count++;
              } else {
                // Yeni blok (2 saatlik)
                subjectTeacherBlocks.set(key, { 
                  subjectId: slot.subjectId!, 
                  teacherId: slot.teacherId!, 
                  count: 2 
                });
              }
            } else {
              // Yeni blok (1 saatlik)
              subjectTeacherBlocks.set(key, { 
                subjectId: slot.subjectId!, 
                teacherId: slot.teacherId!, 
                count: 1 
              });
            }
          } else {
            // İlk periyot - yeni blok (1 saatlik)
            subjectTeacherBlocks.set(key, { 
              subjectId: slot.subjectId!, 
              teacherId: slot.teacherId!, 
              count: 1 
            });
          }
        }
      }
      
      // Blokları analiz et
      subjectTeacherBlocks.forEach((block, key) => {
        const subject = allSubjects.find(s => s.id === block.subjectId);
        
        if (subject?.distributionPattern) {
          const distributionBlocks = parseDistributionPattern(subject.distributionPattern);
          
          // Bu dersin dağıtım şeklinde bu boyutta bir blok var mı?
          const hasMatchingBlock = distributionBlocks.includes(block.count);
          
          if (!blocksBySubject[subject.name]) {
            blocksBySubject[subject.name] = { success: 0, total: 0 };
          }
          
          blocksBySubject[subject.name].total++;
          totalBlocks++;
          
          if (hasMatchingBlock) {
            blocksBySubject[subject.name].success++;
            successfulBlocks++;
          }
        }
      });
    });
  });
  
  return { successfulBlocks, totalBlocks, blocksBySubject };
}

// --- END OF FILE src/utils/scheduleGeneration.ts ---