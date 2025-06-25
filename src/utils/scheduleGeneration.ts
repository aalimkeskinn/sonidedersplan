// --- START OF FILE src/utils/scheduleGeneration.ts ---

import { DAYS, PERIODS, Schedule, Teacher, Class, Subject, ScheduleSlot } from '../types';
import { SubjectTeacherMapping, EnhancedGenerationResult } from '../types/wizard';
import { TimeConstraint } from '../types/constraints';

/**
 * Sistematik olarak, çakışmaları ve zaman kısıtlamalarını dikkate alarak ders programını oluşturur.
 * Bu versiyon, CSV'deki haftalık saatleri tam olarak uygular ve fazla atama yapmaz.
 */
export function generateSystematicSchedule(
  mappings: SubjectTeacherMapping[],
  allTeachers: Teacher[],
  allClasses: Class[],
  allSubjects: Subject[],
  timeConstraints: TimeConstraint[]
): EnhancedGenerationResult {
  
  const startTime = Date.now();
  console.log('🚀 Program oluşturma başlatıldı (v32 - Kesin Saat Kontrolü)...');

  // --- Hazırlık Aşaması ---
  const classScheduleGrids: { [classId: string]: Schedule['schedule'] } = {};
  const teacherAvailability = new Map<string, Set<string>>();
  const classAvailability = new Map<string, Set<string>>();
  
  // *** YENİ: Öğretmen bazlı hedef saat takibi ***
  const teacherTargetHours = new Map<string, number>();
  const teacherAssignedHours = new Map<string, number>();
  
  // CSV'den gelen toplam saatleri hesapla
  mappings.forEach(m => {
    const currentTarget = teacherTargetHours.get(m.teacherId) || 0;
    teacherTargetHours.set(m.teacherId, currentTarget + m.weeklyHours);
    teacherAssignedHours.set(m.teacherId, 0);
  });

  console.log('📊 Öğretmen hedef saatleri:', Array.from(teacherTargetHours.entries()).map(([id, hours]) => {
    const teacher = allTeachers.find(t => t.id === id);
    return `${teacher?.name}: ${hours} saat`;
  }));

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
    
    // *** YENİ: Öğretmenin hedef saatini aştı mı kontrol et ***
    const currentAssigned = teacherAssignedHours.get(teacherId) || 0;
    const targetHours = teacherTargetHours.get(teacherId) || 0;
    
    if (currentAssigned >= targetHours) {
      console.log(`⚠️ ${allTeachers.find(t => t.id === teacherId)?.name} hedef saatini aştı: ${currentAssigned}/${targetHours}`);
      return false;
    }
    
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
            
            // *** YENİ: Öğretmenin atanan saatini artır ***
            teacherAssignedHours.set(teacherId, currentAssigned + 1);
            
            return true;
        }
    }
    return false;
  };

  // Sınıfları seviyeye göre sırala (Anaokulu -> İlkokul -> Ortaokul)
  const sortedClassIds = Array.from(selectedClassIds).sort((a, b) => {
    const classA = allClasses.find(c => c.id === a);
    const classB = allClasses.find(c => c.id === b);
    const levelOrder = { 'Anaokulu': 1, 'İlkokul': 2, 'Ortaokul': 3 };
    return (levelOrder[classA?.level || 'Ortaokul'] - levelOrder[classB?.level || 'Ortaokul']) || classA!.name.localeCompare(classB!.name);
  });
  
  for (const classId of sortedClassIds) {
    const classItem = allClasses.find(c => c.id === classId)!;
    console.log(`\n🏫 ${classItem.name} sınıfı için ders yerleştirme başlatılıyor...`);
    
    const tasksForThisClass = lessonTasks.filter(t => t.mapping.classId === classId && !t.placed);

    // Dersleri haftalık saatine göre sırala (fazla saatli dersler önce)
    tasksForThisClass.sort((a, b) => (b.mapping.weeklyHours) - (a.mapping.weeklyHours));

    let placedInThisClass = 0;
    tasksForThisClass.forEach(task => {
        const allPossibleSlots: string[] = [];
        DAYS.forEach(day => PERIODS.forEach(period => {
            if (!classAvailability.get(classId)?.has(`${day}-${period}`)) {
                allPossibleSlots.push(`${day}-${period}`);
            }
        }));
        allPossibleSlots.sort(() => Math.random() - 0.5);
        
        if (placeTask(task, allPossibleSlots)) {
          task.placed = true;
          placedInThisClass++;
        }
    });
    
    console.log(`  ✅ ${classItem.name}: ${placedInThisClass}/${tasksForThisClass.length} ders yerleştirildi`);
  }

  // *** ETÜT DOLDURMA AŞAMASI KALDIRILDI ***
  // Artık hedef saatleri aşmayacağız, sadece CSV'deki saatleri uygulayacağız

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

  // *** YENİ: Detaylı öğretmen saat raporu ***
  console.log('\n📊 Öğretmen Saat Raporu:');
  Array.from(teacherTargetHours.entries()).forEach(([teacherId, targetHours]) => {
    const teacher = allTeachers.find(t => t.id === teacherId);
    const assignedHours = teacherAssignedHours.get(teacherId) || 0;
    const status = assignedHours === targetHours ? '✅' : assignedHours < targetHours ? '⚠️' : '❌';
    console.log(`  ${status} ${teacher?.name}: ${assignedHours}/${targetHours} saat`);
  });

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

  // *** YENİ: Hedef saat kontrolü uyarıları ***
  const hourMismatches: string[] = [];
  Array.from(teacherTargetHours.entries()).forEach(([teacherId, targetHours]) => {
    const teacher = allTeachers.find(t => t.id === teacherId);
    const assignedHours = teacherAssignedHours.get(teacherId) || 0;
    
    if (assignedHours !== targetHours) {
      hourMismatches.push(`${teacher?.name}: Hedef ${targetHours} saat, Atanan ${assignedHours} saat`);
    }
  });

  if (hourMismatches.length > 0) {
    finalWarnings.push("Öğretmen Saat Uyumsuzlukları:\n" + hourMismatches.join('\n'));
  }

  return {
    success: finalSchedules.length > 0,
    schedules: finalSchedules,
    statistics: stats,
    warnings: finalWarnings,
    errors: [],
  };
}