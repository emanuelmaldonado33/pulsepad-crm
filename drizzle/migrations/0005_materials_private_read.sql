DROP POLICY "Lectura pública de materiales" ON storage.objects;
CREATE POLICY "Equipo lee materiales" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'materials');