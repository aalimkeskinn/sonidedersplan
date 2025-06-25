// --- START OF FILE src/utils/subjectTeacherMapping.ts ---

import { Teacher, Class, Subject } from '../types';
import { WizardData, SubjectTeacherMapping } from '../types/wizard';

/**
 * Sihirbaz verilerini kullanarak, program oluşturma algoritması için
 * somut bir görev listesi (SubjectTeacherMapping) oluşturur.
 * Bu fonksiyon, CSV'den gelen ve veritabanına yazılan atama verilerini temel alır.
 * 
 * @param wizardData Sihirbazdaki tüm kullanıcı seçimlerini içeren ana veri yapısı.
 * @param allTeachers Sistemdeki tüm öğretmenlerin listesi.
 * @param allClasses Sistemdeki tüm sınıfların listesi.
 * @param allSubjects Sistemdeki tüm derslerin listesi.
 * @returns Oluşturulan görev listesi (mappings) ve olası hataları içeren bir nesne.
 */
export function createSubjectTeacherMappings(
  wizardData: WizardData,
  allTeachers: Teacher[],
  allClasses: Class[],
  allSubjects: Subject[]
): { mappings: SubjectTeacherMapping[], errors: string[] } {
  
  const mappings: SubjectTeacherMapping[] = [];
  const errors: string[] = [];

  // Sihirbazda seçilen öğelerin ID'lerini Set'lere alarak hızlı arama yap.
  const selectedClassIds = new Set(wizardData.classes.selectedClasses);
  const selectedSubjectIds = new Set(wizardData.subjects.selectedSubjects);
  const selectedTeacherIds = new Set(wizardData.teachers.selectedTeachers);

  // 1. ADIM: Sadece sihirbazda seçilmiş sınıfları döngüye al.
  for (const classId of selectedClassIds) {
    const classItem = allClasses.find(c => c.id === classId);
    
    // Eğer sınıf bulunamazsa veya sınıfa hiç öğretmen/ders atanmamışsa, bu sınıfı atla.
    if (!classItem || !classItem.assignments) {
      continue;
    }

    // 2. ADIM: Bu sınıfa özel olarak atanmış öğretmen-ders gruplarını (assignments) döngüye al.
    // Bu, CSV'den gelen %100 doğru veridir.
    for (const assignment of classItem.assignments) {
      const teacherId = assignment.teacherId;

      // Eğer bu atamadaki öğretmen, sihirbazda seçilmemişse, bu atamayı dikkate alma.
      if (!selectedTeacherIds.has(teacherId)) {
        continue;
      }
      
      // 3. ADIM: Bu öğretmenin bu sınıfta vereceği spesifik dersleri döngüye al.
      for (const subjectId of assignment.subjectIds) {
        
        // Eğer bu ders, sihirbazda seçilmemişse ("check" edilmemişse), bu dersi dikkate alma.
        if (!selectedSubjectIds.has(subjectId)) {
          continue;
        }
        
        const subject = allSubjects.find(s => s.id === subjectId);
        
        // Eğer ders geçerliyse, görev listesine (mappings) ekle.
        if (subject) {
            // Güvenlik kontrolü: Aynı ders-sınıf kombinasyonunu birden fazla eklemeyi önle.
            const mappingExists = mappings.some(m => m.classId === classId && m.subjectId === subjectId);
            if (!mappingExists) {
                mappings.push({
                  id: `${classId}-${subjectId}`,
                  classId,
                  subjectId,
                  teacherId,
                  // 4. ADIM: Haftalık ders saatini, sihirbazda kullanıcının girdiği değerden al.
                  // Eğer sihirbazda bir değer girilmemişse, dersin varsayılan saatini kullan.
                  weeklyHours: wizardData.subjects.subjectHours[subjectId] || subject.weeklyHours,
                  assignedHours: 0, // Başlangıçta 0 olarak ayarla
                  priority: 'medium', // Bu alan şimdilik kullanılmıyor ama yapısal olarak kalabilir
                });
            }
        }
      }
    }
  }
  
  // Eğer hiç geçerli atama bulunamadıysa kullanıcıyı bilgilendir.
  if (mappings.length === 0 && wizardData.subjects.selectedSubjects.length > 0) {
    errors.push("Seçimleriniz arasında geçerli bir ders atama ilişkisi bulunamadı. Lütfen 'Sınıflar' veya 'Veri Yönetimi' ekranından öğretmenlere ders atadığınızdan emin olun.");
  }

  return { mappings, errors };
}

// --- END OF FILE src/utils/subjectTeacherMapping.ts ---