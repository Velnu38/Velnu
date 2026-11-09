-- Match the composite job foreign-key order for deletion/update checks.
create index job_materials_job_fk on private.job_materials(job_id,business_id);
create index job_template_applications_job_fk on private.job_template_applications(job_id,business_id);
