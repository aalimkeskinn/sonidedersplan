// --- START OF FILE src/utils/scheduleGeneration.ts ---

import { DAYS, PERIODS, Schedule, Teacher, Class, Subject, ScheduleSlot } from '../types';
import { SubjectTeacherMapping, EnhancedGenerationResult } from '../types/wizard';
import { TimeConstraint } from '../types/constraints';

/**
 * Sistematik olarak, çakışmaları ve zaman kısıtlamalarını dikkate alarak ders programını oluşturur.
 * Bu versiyon, sınıf bazlı yerleştirme yapar, dersleri zorluk derecesine göre sıralar,
 * ve yerleştirilemeyen dersler için detaylı bir analiz raporu sunar.
 */
export function generateSystematicSchedule(
  mappings: SubjectTeacherMapping[],
  allTeachers: Teacher[],
  allClasses: Class[],
  allSubjects: Subject[],
  timeConstraints: TimeConstraint[]
): EnhancedGenerationResult {
  
  const startTime = Date.now();
  console.log('🚀 Program oluşturma başlatıldı (v31 - Detaylı Raporlama)...');

  // --- Hazırlık Aşaması ---
  const classScheduleGrids: { [classId: string]: Schedule['schedule'] } = {};
  const teacherAvailability = new Map<string, Set<string>>();
  const classAvailability = new Map<string, Set<string>>();
  
  const classTargetHours = new Map<string, number>();
  mappings.forEach(m => {
    const currentHours = classTargetHours.get(m.classId) || 0;
    classTargetHours.set(m.classId, currentHours + m.weeklyHours);
  });

  const selectedClassIds = new Set(mappings.map(m => m.classId));

  allClasses.forEach(c => {
    if (selectedClassIds.has(c.id)) {
      classScheduleGrids[c.id] = {};
      classAvailability.set(c.id, new Set<string>());
      DAYS.forEach(day => { 
          classScheduleGrids[c.id][day] = {};
          const lunchPeriod = c.level === 'Ortaokul' ? '6' : '5';
          if (PERIODS.includes(lunchPeriod)) {
            classScheduleGrids[c.id][day][lunchPeriod] = { isFixed: true, classId: 'fixed-period', subjectId: 'Yemek' };
            classAvailability.get(c.id)!.add(`${day}-${lunchPeriod}`);
          }
      });
    }
  });
  
  mappings.forEach(m => {
      if (!teacherAvailability.has(m.teacherId)) {
          teacherAvailability.set(m.teacherId, new Set<string>());
      }
  });
  
  const constraintMap = new Map<string, string>();
  timeConstraints.forEach(c => {
    const key = `${c.entityType}-${c.entityId}-${c.day}-${c.period}`;
    constraintMap.set(key, c.constraintType);
  });

  // --- Ders Yerleştirme Aşaması ---
  const lessonTasks: { mapping: SubjectTeacherMapping, taskId: string, placed: boolean }[] = [];
  mappings.forEach(mapping => {
    for (let i = 0; i < mapping.weeklyHours; i++) {
      lessonTasks.push({ mapping, taskId: `${mapping.id}-${i}`, placed: false });
    }
  });
  
  const placeTask = (task: { mapping: SubjectTeacherMapping }, slotsToTry: string[]): boolean => {
    const { teacherId, classId, subjectId } = task.mapping;
    
    for (const slotKey of slotsToTry) {
        const [day, period] = slotKey.split('-');
        
        const isTeacherUnavailable = constraintMap.get(`teacher-${teacherId}-${day}-${period}`) === 'unavailable';
        const isClassUnavailable = constraintMap.get(`class-${classId}-${day}-${period}`) === 'unavailable';
        const isSubjectUnavailable = constraintMap.get(`subject-${subjectId}-${day}-${period}`) === 'unavailable';
        
        const isTeacherBusy = teacherAvailability.get(teacherId)?.has(slotKey) ?? false;
        const isClassBusy = classAvailability.get(classId)?.has(slotKey) ?? false;

        if (!isTeacherBusy && !isClassBusy && !isTeacherUnavailable && !isClassUnavailable && !isSubjectUnavailable) {
            classScheduleGrids[classId][day][period] = { subjectId, teacherId, classId, isFixed: false };
            teacherAvailability.get(teacherId)!.add(slotKey);
            classAvailability.get(classId)?.add(slotKey);
            return true;
        }
    }
    return false;
  };

  const sortedClassIds = Array.from(selectedClassIds).sort((a, b) => {
    const classA = allClasses.find(c => c.id === a);
    const classB = allClasses.find(c => c.id === b);
    const levelOrder = { 'Anaokulu': 1, 'İlkokul': 2, 'Ortaokul': 3 };
    return (levelOrder[classA?.level || 'Ortaokul'] - levelOrder[classB?.level || 'Ortaokul']) || classA!.name.localeCompare(classB!.name);
  });
  
  for (const classId of sortedClassIds) {
    const tasksForThisClass = lessonTasks.filter(t => t.mapping.classId === classId && !t.placed);

    tasksForThisClass.sort((a, b) => (b.mapping.weeklyHours) - (a.mapping.weeklyHours));

    tasksForThisClass.forEach(task => {
        const allPossibleSlots: string[] = [];
        DAYS.forEach(day => PERIODS.forEach(period => {
            if (!classAvailability.get(classId)?.has(`${day}-${period}`)) {
                allPossibleSlots.push(`${day}-${period}`);
            }
        }));
        allPossibleSlots.sort(() => Math.random() - 0.5);
        placeTask(task, allPossibleSlots);
    });
  }

  // --- Etüt Doldurma Aşaması ---
  console.log('🔄 Eksik saatler için akıllı etüt doldurma adımı başlatılıyor...');
  const etutSubject = allSubjects.find(s => s.name.toLowerCase().includes('etüt')) || { id: 'etut-dersi', name: 'Etüt', branch: 'Etüt' };
  
  for (const classId of sortedClassIds) {
    const classItem = allClasses.find(c => c.id === classId)!;
    const classGrid = classScheduleGrids[classId];
    let currentHours = 0;
    DAYS.forEach(day => PERIODS.forEach(period => { if (classGrid[day]?.[period] && !classGrid[day][period].isFixed) currentHours++; }));
    
    const TOTAL_TARGET_HOURS = classTargetHours.get(classId) || 45;
    const hoursToFill = TOTAL_TARGET_HOURS - currentHours;

    if (hoursToFill > 0) {
        let dutyTeacher = allTeachers.find(t => t.id === classItem.classTeacherId);
        if (!dutyTeacher) {
            const teachersForThisClass = new Set(mappings.filter(m => m.classId === classId).map(m => m.teacherId));
            if (teachersForThisClass.size > 0) {
                const teacherLoads = Array.from(teachersForThisClass).map(teacherId => ({ teacherId, load: teacherAvailability.get(teacherId)?.size || 0 }));
                teacherLoads.sort((a, b) => a.load - b.load);
                dutyTeacher = allTeachers.find(t => t.id === teacherLoads[0].teacherId);
            }
        }
        
        if (dutyTeacher && teacherAvailability.has(dutyTeacher.id)) {
            let filledCount = 0;
            const emptySlotsForClass = [];
            DAYS.forEach(day => PERIODS.forEach(period => { if (!classAvailability.get(classId)?.has(`${day}-${period}`)) emptySlotsForClass.push(`${day}-${period}`); }));
            emptySlotsForClass.sort(() => Math.random() - 0.5);

            for (const slotKey of emptySlotsForClass) {
                if (filledCount >= hoursToFill) break;
                if (!teacherAvailability.get(dutyTeacher.id)?.has(slotKey)) {
                    const [day, period] = slotKey.split('-');
                    classGrid[day][period] = { subjectId: etutSubject.id, teacherId: dutyTeacher.id, classId, isFixed: false };
                    teacherAvailability.get(dutyTeacher.id)!.add(slotKey);
                    classAvailability.get(classId)!.add(slotKey);
                    filledCount++;
                }
            }
            console.log(`  -> ${classItem.name} için ${filledCount}/${hoursToFill} saat etüt atandı. Sorumlu: ${dutyTeacher.name}`);
        } else {
             console.warn(`  -> ${classItem.name} için etüt atayacak uygun öğretmen bulunamadı.`);
        }
    }
  }

  // --- Sonuçları Oluşturma ve Raporlama Aşaması ---
  const teacherSchedules: { [teacherId: string]: Schedule['schedule'] } = {};
  Object.values(classScheduleGrids).forEach(classGrid => {
    Object.entries(classGrid).forEach(([day, periods]) => {
      Object.entries(periods).forEach(([period, slot]) => {
        if (slot && slot.teacherId && !slot.isFixed) {
          if (!teacherSchedules[slot.teacherId]) {
            teacherSchedules[slot.teacherId] = {};
            DAYS.forEach(d => teacherSchedules[slot.teacherId][d] = {});
          }
          teacherSchedules[slot.teacherId][day][period] = { classId: slot.classId, subjectId: slot.subjectId, isFixed: false };
        }
      });
    });
  });

  const finalSchedules: Omit<Schedule, 'id' | 'createdAt'>[] = Object.entries(teacherSchedules).map(([teacherId, schedule]) => ({
    teacherId, schedule, updatedAt: new Date(),
  }));

  const unassignedTasks = lessonTasks.filter(task => !task.placed);
  const unassignedLessonsSummary = new Map<string, { className: string, subjectName: string, teacherName: string, missingHours: number }>();
  
  unassignedTasks.forEach(task => {
    const key = task.mapping.id;
    if (!unassignedLessonsSummary.has(key)) {
        unassignedLessonsSummary.set(key, {
            className: allClasses.find(c => c.id === task.mapping.classId)?.name || 'Bilinmeyen Sınıf',
            subjectName: allSubjects.find(s => s.id === task.mapping.subjectId)?.name || 'Bilinmeyen Ders',
            teacherName: allTeachers.find(t => t.id === task.mapping.teacherId)?.name || 'Bilinmeyen Öğretmen',
            missingHours: 0
        });
    }
    unassignedLessonsSummary.get(key)!.missingHours++;
  });

  const stats = {
    totalLessonsToPlace: lessonTasks.length,
    placedLessons: lessonTasks.length - unassignedTasks.length,
    unassignedLessons: Array.from(unassignedLessonsSummary.values())
  };

  console.log(`✅ Program oluşturma tamamlandı. Süre: ${(Date.now() - startTime) / 1000} saniye.`);
  console.log(`📊 İstatistik: ${stats.placedLessons} / ${stats.totalLessonsToPlace} ders yerleştirildi.`);
  
  const finalWarnings: string[] = [];
  if (stats.unassignedLessons.length > 0) {
    finalWarnings.push(`Bazı dersler yerleştirilemedi. Toplam eksik: ${stats.unassignedLessons.reduce((sum, ul) => sum + ul.missingHours, 0)} saat.`);
  }

  // *** YENİ: Yerleştirilemeyen derslerin nedenini analiz et ve uyarılara ekle ***
  const unplacedTaskDetails: string[] = [];
  stats.unassignedLessons.forEach(ul => {
    // Sadece bir tane örnek task alalım, hepsi aynı ders için.
    const sampleTask = unassignedTasks.find(t => t.mapping.classId === allClasses.find(c => c.name === ul.className)?.id && t.mapping.subjectId === allSubjects.find(s => s.name === ul.subjectName)?.id);
    if (!sampleTask) return;

    const { teacherId, classId, subjectId } = sampleTask.mapping;
    
    let reason = "Tüm uygun zaman dilimleri başka dersler tarafından dolduruldu veya öğretmen meşguldü.";
    const conflictReasons = new Set<string>();
    
    // Öğretmenin tüm boş saatlerini bulalım
    const teacherFreeSlots = new Set<string>();
    DAYS.forEach(day => PERIODS.forEach(period => {
        if (!teacherAvailability.get(teacherId)?.has(`${day}-${period}`)) {
            teacherFreeSlots.add(`${day}-${period}`);
        }
    }));

    // Sınıfın tüm boş saatlerini bulalım
    const classFreeSlots = new Set<string>();
    DAYS.forEach(day => PERIODS.forEach(period => {
        if (!classAvailability.get(classId)?.has(`${day}-${period}`)) {
            classFreeSlots.add(`${day}-${period}`);
        }
    }));
    
    // Ortak boşlukları bul
    const commonFreeSlots = [...teacherFreeSlots].filter(slot => classFreeSlots.has(slot));
    
    if(commonFreeSlots.length > 0) {
        commonFreeSlots.forEach(slotKey => {
            const [day, period] = slotKey.split('-');
            if (constraintMap.get(`teacher-${teacherId}-${day}-${period}`) === 'unavailable') conflictReasons.add(`${ul.teacherName} için ${day} ${period}. saat kısıtlaması`);
            if (constraintMap.get(`class-${classId}-${day}-${period}`) === 'unavailable') conflictReasons.add(`${ul.className} için ${day} ${period}. saat kısıtlaması`);
            if (constraintMap.get(`subject-${subjectId}-${day}-${period}`) === 'unavailable') conflictReasons.add(`${ul.subjectName} için ${day} ${period}. saat kısıtlaması`);
        });
        if (conflictReasons.size > 0) {
          reason = `Ortak boşluklar bulundu ancak şu kısıtlamalar engelledi: ${Array.from(conflictReasons).join(', ')}`;
        } else {
          reason = "Bilinmeyen bir sıralama/kilitlenme sorunu yaşandı.";
        }
    }
    
    unplacedTaskDetails.push(`- ${ul.className} / ${ul.teacherName} / ${ul.subjectName} (${ul.missingHours} saat eksik): ${reason}`);
  });

  if(unplacedTaskDetails.length > 0) {
    finalWarnings.push("Yerleştirilememe Nedenleri:\n" + unplacedTaskDetails.join('\n'));
  }

  return {
    success: finalSchedules.length > 0,
    schedules: finalSchedules,
    statistics: stats,
    warnings: finalWarnings,
    errors: [],
  };
}